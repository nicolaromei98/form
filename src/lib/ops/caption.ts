import { VIEW_LABEL } from "@/lib/domain/labels";
import { CAPTION_PARTS, CAPTION_TEXT } from "@/lib/domain/limits";
import type { PersonId } from "@/lib/domain/schema/ids";
import type { ViewKind } from "@/lib/domain/schema/primitives";
import { type LocalIntent, localCaption, teamStatus } from "@/lib/ops/local-intents";
import { type NoticeKey, noticePart } from "@/lib/ops/notices";
import { type QueryNote, renderNote } from "@/lib/ops/queries";
import type { OpResult } from "@/lib/ops/reduce";
import { type AnyOpDef, SYSTEM_OPS } from "@/lib/ops/registry";
import { type AnyDoc, type CaptionEnv, type CaptionPart, fitText, type Rejection } from "@/lib/ops/registry/_contract";
import { captionKey, fillNames, joinNames, part, title } from "@/lib/ops/registry/_helpers";

/**
 * The caption composer (plan §1.3, §5.9). A caption is built only from the ops that actually
 * applied (through their registry captions), the local intents, typed query notes and fixed
 * notices. The parser never writes a change caption.
 *
 * The caption is the agent's only voice, so it stays one short line (the caption policy,
 * DECISIONS "Wave 5 outcomes and the caption policy"):
 * 1. parts that repeat one template across entities are said once (`groupParts`);
 * 2. parts another part of the command implies are dropped (`dropImplied`);
 * 3. demo expansions speak as one (`EXPANSIONS`);
 * 4. a view that opens as a side effect (a reveal) says nothing of itself, unless the command
 *    created it: then "{View} view added", once, after the change (`announceView`). A view's
 *    status sentence is said only when opening it is the command's intent;
 * 5. what was already true comes first and is never swallowed by what applied around it;
 * 6. a timeline born on an unconfirmed start says its dates are samples (createProject's part);
 * 7. at most four " · " parts (`capParts`).
 */

export type CaptionTone = "done" | "proposal" | "info" | "clarify" | "unsupported";

export interface Caption {
  /** At most four " · " parts and 280 characters, cut at a part boundary */
  text: string;
  tone: CaptionTone;
  /** True exactly when the command created a history entry */
  undoable: boolean;
}

/** An op refused before it reached a document: no project to apply it to, or over the command limit */
export interface UnroutedResult {
  kind: "rejected";
  doc: null;
  op: unknown;
  rejection: Rejection;
}

/** One op of a command, with the document it saw */
export interface OpOutcome {
  def: AnyOpDef | null;
  /** The document before this op (null when it reached none) */
  before: AnyDoc | null;
  result: OpResult<AnyDoc> | UnroutedResult;
}

/**
 * The /demo expansions (`lib/demo/seed.ts`) a command can carry, so that they speak as one
 * (caption policy rule 3). The producer that ran the expansion names it; the words are composed
 * here, from the ops that applied.
 * - "sampleTeam": "Add a sample team": the sample people join, and the template tasks get their
 *   sample owners. "Sample team added · Marta, Sara and Luca · Marta over capacity".
 * - "demoProject": creating a project from the website template, with the sample people it
 *   needs: the createProject part speaks for the people too ("Timeline created · 4 tasks").
 */
export type Expansion = "sampleTeam" | "demoProject";

export interface ComposeInput {
  outcomes: readonly OpOutcome[];
  local: readonly LocalIntent[];
  /** Views the command created on the same project, in creation order */
  addedViews: readonly ViewKind[];
  notes: readonly QueryNote[];
  notices: readonly NoticeKey[];
  reply?: { tone: "clarify"; text: string };
  env: CaptionEnv;
  historyEntry: boolean;
  /** Direct edits show no caption (v0 parity), unless something was refused or a proposal resolved */
  quiet?: boolean;
  /** The demo expansion the command ran, if any (rule 3) */
  expansion?: Expansion;
}

const RESOLVES_PROPOSAL: ReadonlySet<string> = new Set(["acceptProposal", "discardProposal"]);

const SEPARATOR = " · ";

const asList = (p: CaptionPart | CaptionPart[] | null): CaptionPart[] => (p === null ? [] : Array.isArray(p) ? p : [p]);

/* ------------------------------------------------------------------
   Demo expansions (rule 3)
   ------------------------------------------------------------------ */

/** An applied op an expansion speaks for, with its payload */
interface Spoken {
  name: string;
  op: { op: string; personId?: PersonId; name?: string };
}

interface Voice {
  /** The ops whose own parts give way to the expansion's */
  ops: ReadonlySet<string>;
  /** The views the expansion brings on screen and speaks for: they announce nothing of their own */
  views: readonly ViewKind[];
  /** Whether the expansion speaks, from the names of the ops that applied */
  speaks(applied: ReadonlySet<string>): boolean;
  /** Its parts, in place of the first op it speaks for; none when another op's part speaks for it */
  parts(spoken: readonly Spoken[], env: CaptionEnv): CaptionPart[];
}

const EXPANSIONS: Readonly<Record<Expansion, Voice>> = {
  sampleTeam: {
    ops: new Set(["addPerson", "restorePerson", "addMember", "assignTask"]),
    views: ["team"],
    speaks: (applied) => ["addPerson", "restorePerson", "addMember", "assignTask"].some((n) => applied.has(n)),
    parts(spoken, env) {
      const names: string[] = [];
      const seen = new Set<PersonId>();
      let assigned = 0;
      for (const s of spoken) {
        if (s.name === "assignTask") {
          assigned += 1;
          continue;
        }
        const id = s.op.personId!;
        if (seen.has(id)) continue;
        seen.add(id);
        names.push(title(s.name === "addPerson" ? s.op.name! : env.personName(id)));
      }
      const out = names.length
        ? [part("Sample team added"), part(joinNames(names))]
        : [part(`${assigned} task${assigned === 1 ? "" : "s"} assigned to the sample team`)];
      const status = teamStatus(env);
      if (status !== null) out.push(part(status));
      return out;
    },
  },
  demoProject: {
    ops: new Set(["addPerson", "restorePerson"]),
    views: [],
    // Only once the project is there: its part then speaks for the people it brought in
    speaks: (applied) => applied.has("createProject"),
    parts: () => [],
  },
};

/* ------------------------------------------------------------------
   Parts
   ------------------------------------------------------------------ */

/** A later part with the same key replaces the earlier one in place */
export function mergeKeys(parts: readonly CaptionPart[]): CaptionPart[] {
  const out: CaptionPart[] = [];
  const at = new Map<string, number>();
  for (const p of parts) {
    const i = p.key === undefined ? undefined : at.get(p.key);
    if (i !== undefined) out[i] = p;
    else {
      if (p.key !== undefined) at.set(p.key, out.length);
      out.push(p);
    }
  }
  return out;
}

/** Rule 2: drops the parts another part implies ("Giulia joins the project" after "Giulia added to the team") */
export function dropImplied(parts: readonly CaptionPart[]): CaptionPart[] {
  const implied = new Set(parts.flatMap((p) => p.implies ?? []));
  return implied.size === 0 ? [...parts] : parts.filter((p) => p.key === undefined || !implied.has(p.key));
}

/**
 * Rule 1: parts with the same group template are said once, in the first one's place, with the
 * names joined ("Giulia and Paolo added to the team · capacity not set").
 */
export function groupParts(parts: readonly CaptionPart[]): CaptionPart[] {
  const out: CaptionPart[] = [];
  const at = new Map<string, number>();
  const names = new Map<number, string[]>();
  for (const p of parts) {
    if (!p.group) {
      out.push(p);
      continue;
    }
    const k = `${p.group.template}\u0000${p.group.plural ?? ""}`;
    const i = at.get(k);
    if (i === undefined) {
      at.set(k, out.length);
      names.set(out.length, [p.group.name]);
      out.push(p);
    } else names.get(i)!.push(p.group.name);
  }
  for (const [i, list] of names) {
    if (list.length < 2) continue;
    const g = out[i].group!;
    out[i] = { ...out[i], text: fitText(fillNames(g.plural ?? g.template, joinNames(list))) };
  }
  return out;
}

/**
 * Ported from v0 `announceView`, with rule 4: for each view a command added and shows as its
 * intent, the show part's label becomes the announcement ("Team · Marta over capacity" → "Team
 * view added · Marta over capacity") and addView's own part is dropped. An added view with no
 * show part (a reveal, or no show at all) is announced on its own, once, after the change. A view
 * in `silent` (an expansion speaks for it) announces nothing.
 */
export function announceView(parts: readonly CaptionPart[], added: readonly ViewKind[], silent: ReadonlySet<ViewKind> = new Set()): CaptionPart[] {
  let out = [...parts];
  const after: CaptionPart[] = [];
  for (const view of added) {
    const label = VIEW_LABEL[view];
    const announced = `${label} view added`;
    const show = out.findIndex((p) => p.key === captionKey.show(view));
    const own = out.find((p) => p.key === captionKey.viewAdded(view));
    if (show >= 0 && !silent.has(view)) {
      const text = out[show].text;
      const lead = [label, ...(view === "brief" ? ["Status brief"] : [])].find((l) => text === l || text.startsWith(`${l}${SEPARATOR}`));
      out[show] = { ...out[show], text: fitText(lead ? announced + text.slice(lead.length) : `${announced}${SEPARATOR}${text}`) };
    } else if (!silent.has(view)) {
      after.push({ text: announced, key: captionKey.viewAdded(view) });
    }
    if (own) out = out.filter((p) => p !== own);
  }
  return [...out, ...after];
}

/**
 * Rule 7: keeps at most `max` " · " parts. Whole parts are kept while they fit; the first that
 * doesn't is cut at its own " · " boundary. The refusal suffix, when there is one, always stays.
 */
export function capParts(texts: readonly string[], suffix: string | null = null, max = CAPTION_PARTS): string[] {
  const budget = Math.max(1, max - (suffix === null ? 0 : suffix.split(SEPARATOR).length));
  const kept: string[] = [];
  let used = 0;
  for (const text of texts) {
    const segments = text.split(SEPARATOR);
    if (used + segments.length <= budget) {
      kept.push(text);
      used += segments.length;
      continue;
    }
    if (used < budget) kept.push(segments.slice(0, budget - used).join(SEPARATOR));
    break;
  }
  return suffix === null ? kept : [...kept, suffix];
}

/** Joins parts with " · " and cuts at a part boundary so the text stays within 280 characters */
export function joinParts(texts: readonly string[], max = CAPTION_TEXT): string {
  const kept = [...texts];
  while (kept.length > 1 && kept.join(SEPARATOR).length > max) kept.pop();
  return fitText(kept.join(SEPARATOR), max);
}

/* ------------------------------------------------------------------
   The caption
   ------------------------------------------------------------------ */

export function composeCaption(i: ComposeInput): Caption | null {
  if (i.reply) return { text: fitText(i.reply.text, CAPTION_TEXT), tone: "clarify", undoable: i.historyEntry };

  // System ops (rebalanceOrder) fold into their commit: they never speak
  const visible = i.outcomes.filter((o) => !(o.def && SYSTEM_OPS.has(o.def.name)));
  const applied = visible.filter((o) => o.result.kind === "applied");
  const noops = visible.filter((o) => o.result.kind === "noop");
  const rejected = visible.filter((o) => o.result.kind === "rejected");
  if (i.quiet && rejected.length === 0 && !applied.some((o) => RESOLVES_PROPOSAL.has(o.def!.name))) return null;

  // Rule 3: an expansion speaks for its ops once something it stands for applied
  const names = new Set(applied.map((o) => o.def!.name));
  const voice = i.expansion !== undefined && EXPANSIONS[i.expansion].speaks(names) ? EXPANSIONS[i.expansion] : null;
  const spokenFor = (o: OpOutcome) => voice !== null && voice.ops.has(o.def!.name);

  const parts: CaptionPart[] = [];
  // Rule 5: what was already true comes first, whatever applied around it
  for (const o of noops) {
    if (spokenFor(o)) continue;
    const text = o.def!.noopCaption({ op: o.result.op as { op: string }, before: o.before!, env: i.env });
    if (text) parts.push({ text: fitText(text) });
  }
  let voiced = false;
  for (const o of applied) {
    const result = o.result as Extract<OpResult<AnyDoc>, { kind: "applied" }>;
    if (spokenFor(o)) {
      if (!voiced) {
        const spoken = applied.filter(spokenFor).map((s) => ({ name: s.def!.name, op: (s.result as typeof result).op as Spoken["op"] }));
        parts.push(...voice!.parts(spoken, i.env));
        voiced = true;
      }
      continue;
    }
    parts.push(...asList(o.def!.caption({ op: result.op, before: o.before!, after: result.doc, env: i.env })));
  }
  const localParts = i.local.map((l) => localCaption(l, i.env)).filter((p): p is CaptionPart => p !== null);
  const noteParts = i.notes.flatMap((n) => renderNote(n, i.env));
  parts.push(...localParts, ...noteParts, ...i.notices.map(noticePart));

  // Rule 4: a view on screen as a side effect, or one an expansion speaks for, says nothing of itself
  const intended = new Set(i.local.flatMap((l) => (l.kind === "show" && !l.reveal ? [l.view] : [])));
  const silent = new Set((voice?.views ?? []).filter((v) => !intended.has(v)));
  const quietKeys = new Set(
    i.local
      .flatMap((l) => (l.kind === "show" && l.reveal ? [l.view] : []))
      .concat([...silent])
      .filter((v) => !intended.has(v))
      .map((v) => captionKey.show(v)),
  );
  const said = groupParts(dropImplied(mergeKeys(parts))).filter((p) => p.key === undefined || !quietKeys.has(p.key));
  const texts = announceView(said, i.addedViews, silent).map((p) => fitText(p.text));

  let suffix: string | null = null;
  if (rejected.length > 0) {
    const message = rejected[0].result.kind === "rejected" ? rejected[0].result.rejection.message : "";
    if (texts.length === 0) suffix = `Couldn't apply that: ${message}`;
    else suffix = rejected.length === 1 ? `Couldn't apply one change: ${message}` : `Couldn't apply ${rejected.length} changes: ${message}`;
  }
  if (texts.length === 0 && suffix === null) return null;

  let tone: CaptionTone;
  if (applied.some((o) => o.def!.name.startsWith("propose"))) tone = "proposal";
  else if (applied.length > 0) tone = "done";
  else if (rejected.length > 0 && noops.length === 0 && localParts.length === 0 && noteParts.length === 0) tone = "unsupported";
  else if (localParts.length > 0 && noops.length === 0 && noteParts.length === 0) tone = "done";
  else tone = "info";

  return { text: joinParts(capParts(texts, suffix)), tone, undoable: i.historyEntry };
}
