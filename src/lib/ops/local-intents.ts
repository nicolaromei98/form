import { z } from "zod";
import { resolvePerson } from "@/lib/domain/invariants/check";
import { VIEW_LABEL } from "@/lib/domain/labels";
import { TaskId } from "@/lib/domain/schema/ids";
import { type LocalViewState, TimelineZoom } from "@/lib/domain/schema/local";
import { ViewKind } from "@/lib/domain/schema/primitives";
import type {
  CaptionEnv,
  CaptionPart,
  Exempt,
  PaletteEntry,
  ParserExample,
  ParserFamily,
  TransportSpec,
} from "@/lib/ops/registry/_contract";
import { captionKey, joinNames, part, SAMPLE_DATES, title } from "@/lib/ops/registry/_helpers";

/**
 * Local intents (plan §1.2, Q6): show a view, select a task, zoom the timeline. They change only
 * the local view state, so they are never ops: never in a commit, the undo stack or Activity. A
 * command carries them next to its ops, and the runner applies them after the commits.
 *
 * A show is either the command's intent ("Show the team workload") or a reveal: the view comes on
 * screen as a side effect of a change ("Assign Development to Sara" opens the Team). A reveal
 * moves the tab the same way but says nothing of the view: no status sentence, only "{View} view
 * added" when the command created the view (caption policy rule 4).
 */

export const LocalIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("show"), view: ViewKind, reveal: z.literal(true).optional() }).strict(),
  z.object({ kind: z.literal("select"), taskId: TaskId.nullable() }).strict(),
  z.object({ kind: z.literal("zoom"), zoom: TimelineZoom }).strict(),
]);
export type LocalIntent = z.infer<typeof LocalIntentSchema>;
export type LocalIntentKind = LocalIntent["kind"];

/** What the palette, the parser test and the transport list read of a local intent */
export interface LocalIntentDef {
  kind: LocalIntentKind;
  parser: { family: ParserFamily; examples: readonly ParserExample[] } | Exempt;
  palette: readonly PaletteEntry[] | Exempt;
  transport: TransportSpec | Exempt;
}

const BOTH = ["demo", "app"] as const;

export const LOCAL_INTENTS: Readonly<Record<LocalIntentKind, LocalIntentDef>> = {
  show: {
    kind: "show",
    parser: { family: "view", examples: [{ say: "Show me everything again", fixture: "demo" }] },
    palette: [
      { group: "Brief", phrase: "Write a status update for the client", rank: 10, needs: "project", fixture: "demo", surfaces: BOTH },
      { group: "Brief", phrase: "What do I tell the client?", rank: 40, needs: "project", fixture: "demo", surfaces: BOTH },
      { group: "Team", phrase: "Show the team workload", rank: 10, needs: "project", fixture: "demo", surfaces: BOTH },
      { group: "Team", phrase: "Who's overloaded?", rank: 20, needs: "project", fixture: "demo", surfaces: BOTH },
    ],
    transport: { tool: "view", action: "show" },
  },
  select: {
    kind: "select",
    parser: { exempt: "Selection is a pointer gesture: commands never select on their own (v0 Point & Ask)." },
    palette: { exempt: "Selection is a pointer gesture, not a palette command." },
    transport: { exempt: "Selection is a pointer gesture; the agent names tasks by id instead." },
  },
  zoom: {
    kind: "zoom",
    parser: { exempt: "The timeline zoom arrives with the Timeline v2 visuals.", until: 4 },
    palette: { exempt: "The timeline zoom arrives with the Timeline v2 visuals.", until: 4 },
    transport: { tool: "view_option", field: "zoom" },
  },
};

/** The local state after one intent. Normalisation against the project happens in the runner. */
export function applyLocal(local: LocalViewState, intent: LocalIntent): LocalViewState {
  switch (intent.kind) {
    case "show":
      return local.activeView === intent.view ? local : { ...local, activeView: intent.view };
    case "select":
      return local.selectedTaskId === intent.taskId ? local : { ...local, selectedTaskId: intent.taskId };
    case "zoom":
      return local.timelineZoom === intent.zoom ? local : { ...local, timelineZoom: intent.zoom };
  }
}

const NO_TEAM = "Team · no one yet. Use the sample team, or say 'add Giulia to the team'";

/**
 * What the Team view says about its members after the command: "Marta over capacity", "everyone
 * within capacity", or null when the project has no active member.
 */
export function teamStatus(env: CaptionEnv): string | null {
  const project = env.project();
  const ws = env.workspace();
  const members = project ? project.memberIds.filter((id) => typeof resolvePerson(id, ws) === "object") : [];
  if (members.length === 0) return null;
  const over = env.overloads();
  return over.length ? `${joinNames(over.map((o) => o.name))} over capacity` : "everyone within capacity";
}

/**
 * What showing a view says (plan §4.4, local intents), from the after state. The part is keyed
 * `show:{view}`, so `announceView` can turn "Team · …" into "Team view added · …".
 */
export function showCaption(view: ViewKind, env: CaptionEnv): CaptionPart {
  const project = env.project();
  const key = captionKey.show(view);
  switch (view) {
    case "cards":
    case "board":
      return part(VIEW_LABEL[view], key);
    case "timeline": {
      const bits = ["Timeline"];
      if (project?.startDate && !project.startConfirmed) bits.push(SAMPLE_DATES);
      const unsized = project ? Object.values(project.tasks).filter((t) => t.kind === "task" && t.estimateDays === null).length : 0;
      if (unsized > 0) bits.push(`${unsized} task${unsized > 1 ? "s need" : " needs"} a duration`);
      return part(bits.join(" · "), key);
    }
    case "team": {
      const status = teamStatus(env);
      return part(status === null ? NO_TEAM : `Team · ${status}`, key);
    }
    case "focus": {
      const focus = env.focus();
      // Without the planning engine there is nothing to say about the pick
      if (!focus) return part("Focus", key);
      const pick = focus.pick;
      if (!pick) return part("Focus · everything is done", key);
      const name = title(env.taskTitle(pick.taskId));
      const reason = pick.reasons[0]?.text;
      return part(pick.chosenBy === "you" || !reason ? `Focus · ${name}` : `Focus · ${name} — ${reason.toLowerCase()}`, key);
    }
    case "brief": {
      const brief = project?.viewConfig.brief ?? { audience: "client", short: false };
      return part(`Status brief · for the ${brief.audience}${brief.short ? " · short version" : ""} · composed from the project, nothing invented`, key);
    }
  }
}

const ZOOM_TEXT = { day: "days", week: "weeks", month: "months" } as const;

/** A local intent's caption part, or null (a selection and a reveal say nothing) */
export function localCaption(intent: LocalIntent, env: CaptionEnv): CaptionPart | null {
  switch (intent.kind) {
    case "show":
      return intent.reveal ? null : showCaption(intent.view, env);
    case "select":
      return null;
    case "zoom":
      return part(`Timeline · ${ZOOM_TEXT[intent.zoom]}`, "zoom");
  }
}
