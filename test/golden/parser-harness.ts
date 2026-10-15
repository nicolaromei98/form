// The golden parser harness (plan §10.4): legacy fixture states, their migrated v2 twins, both
// parsers run on the same command, and the canonical form the two after-states are compared in.
//
// - The legacy side runs the frozen v0 parser on the v0 document, lowers its ops with
//   test/legacy/lower.ts and applies them to the v2 twin with the real runner.
// - The v2 side runs fastParse on the twin and applies its command with the same runner.
// - The twin is the v0 → v2 migration of the v0 document (demo mode, into the demo workspace), so
//   both sides start from the same documents and every v0 id has a v2 id.
// - Captions read the real planning engine (plan, lanes, focus), on 14 Oct 2026.
//
// Canonical form: every id is replaced by a label made of titles and names, timestamps are left
// out, and so are order and z keys (the lists keep their order instead). Reassign moves keep no
// `why`: v0 had none, and the caption carries it.
import { sampleForMigration } from "@/lib/demo/sample";
import { demoWorkspace } from "@/lib/demo/seed";
import { seededMinter } from "@/lib/domain/ids";
import { sortedByOrder, sortedByZ } from "@/lib/domain/order";
import type { PersonId, ProjectId, TaskId } from "@/lib/domain/schema/ids";
import { defaultLocalViewState, type LocalViewState } from "@/lib/domain/schema/local";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { type FastContext, type FastResult, fastParse, toCommand } from "@/lib/interpret/fast";
import { migrateV0 } from "@/lib/migrate";
import type { CaptionPlanning } from "@/lib/ops/caption-env";
import { type CommandResult, type DocsState, runCommand } from "@/lib/ops/command";
import { CAPTION_PLANNING, liveProjects as storeLiveProjects, parserContext, parserPalette } from "@/lib/store/engine";
import { FIXTURE_NOW, FIXTURE_TODAY } from "../fixtures/v2/build";
import { interpretDemo } from "../legacy/v0/lib/interpret/demo";
import { breakdownFor as legacyBreakdownFor } from "../legacy/v0/lib/interpret/library";
import { applyOperations } from "../legacy/v0/lib/ops";
import type { Doc, Interpretation, Operation } from "../legacy/v0/lib/schema";
import { emptyDoc } from "../legacy/v0/lib/seed";
import { balancePlan } from "../legacy/v0/lib/team";
import { addedViews, announceView } from "../legacy/v0/lib/views";
import { lower } from "../legacy/lower";

/* ------------------------------------------------------------------
   The engine pieces both sides share
   ------------------------------------------------------------------ */

/** Live projects: neither archived nor deleted (the store's own) */
export const liveProjects: (state: DocsState) => ProjectDoc[] = storeLiveProjects;

/** The planning engine behind captions (plan §5.9): the store's own */
export const PLANNING: CaptionPlanning = CAPTION_PLANNING;

/** The palette's phrases as the parser compares them (Q17 tier 1.0) */
export const PALETTE_KEYS: ReadonlySet<string> = parserPalette();

/** A v2 state with its active project and local view state */
export interface V2State {
  docs: DocsState;
  projectId: ProjectId | null;
  local: LocalViewState;
}

/** The fast parser's context on a state: the store's own wiring */
export function fastContext(s: V2State, seed: number): FastContext {
  return parserContext({ docs: s.docs, projectId: s.projectId, local: s.local, today: FIXTURE_TODAY, mint: seededMinter(seed) });
}

/** Runs a command on a state with the real runner and captions */
export function run(s: V2State, cmd: Parameters<typeof runCommand>[1]): CommandResult {
  let n = 0;
  return runCommand(s.docs, cmd, {
    now: FIXTURE_NOW,
    actorId: null,
    projectId: s.projectId,
    local: s.local,
    today: FIXTURE_TODAY,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    planning: PLANNING,
  });
}

/* ------------------------------------------------------------------
   Legacy fixture states
   ------------------------------------------------------------------ */

export const LEGACY_FIXTURES = [
  "empty",
  "demo",
  "demoSelected",
  "demoProposal",
  "demoPlan",
  "demoMood3",
  "demoMoodShown",
  "demoNoTeam",
  "demoUnestimated",
  "demoTimeline",
  "demoAllViews",
  "demoFocus",
  "demoBrief",
  "demoBriefEdited",
  "demoTeamView",
  "demoHideDone",
  "demoProgress",
  "demoSteps",
] as const;
export type LegacyFixture = (typeof LEGACY_FIXTURES)[number];

export interface LegacyState {
  doc: Doc;
  selectedId: string | null;
}

const apply = (doc: Doc, ops: Operation[]) => applyOperations(doc, ops);
const created = (representation?: "cards" | "board" | "timeline") =>
  apply(emptyDoc(), [{ op: "createProject", title: "New website", template: "website", ...(representation ? { representation } : {}) }]);
const withView = (doc: Doc, views: Doc["view"]["representation"][], on: Doc["view"]["representation"]): Doc => ({
  ...doc,
  tool: { ...doc.tool!, views },
  view: { ...doc.view, representation: on },
});

/**
 * The legacy states, built with the frozen v0 reducer (`Math.random` must be seeded by the caller,
 * so v0's uids are stable). Each one is a v0 document plus the v0 selection.
 */
export function legacyState(name: LegacyFixture): LegacyState {
  const demo = created();
  switch (name) {
    case "empty":
      return { doc: emptyDoc(), selectedId: null };
    case "demo":
      return { doc: demo, selectedId: null };
    case "demoSelected":
      return { doc: demo, selectedId: "t-ui" };
    case "demoProposal":
      return { doc: apply(demo, [{ op: "proposeSubtasks", parentId: "t-ui", items: legacyBreakdownFor(demo.tasks["t-ui"]) }]), selectedId: null };
    case "demoPlan":
      return { doc: apply(demo, [{ op: "proposeReassign", moves: balancePlan(demo) }]), selectedId: null };
    case "demoMood3":
      return {
        doc: apply(demo, [
          { op: "addBlock", block: "moodboard" },
          {
            op: "addMoodItems",
            items: [
              { kind: "color", hex: "#0c0c0c", text: null },
              { kind: "note", text: "Warm, tactile, editorial" },
              { kind: "color", hex: "#c65d3b", text: "Terracotta" },
            ],
          },
        ]),
        selectedId: null,
      };
    case "demoMoodShown":
      return { doc: apply(demo, [{ op: "addBlock", block: "moodboard" }]), selectedId: null };
    case "demoNoTeam":
      return {
        doc: { ...demo, people: [], tasks: Object.fromEntries(Object.entries(demo.tasks).map(([id, t]) => [id, { ...t, owner: null }])) },
        selectedId: null,
      };
    case "demoUnestimated":
      return { doc: { ...demo, tasks: { ...demo.tasks, "t-ui": { ...demo.tasks["t-ui"], estimate: null } } }, selectedId: null };
    case "demoTimeline":
      return { doc: created("timeline"), selectedId: null };
    case "demoAllViews":
      return { doc: withView(demo, ["cards", "board", "timeline", "team", "focus", "brief"], "cards"), selectedId: null };
    case "demoFocus":
      return { doc: withView(demo, ["cards", "focus"], "focus"), selectedId: null };
    case "demoBrief":
      return { doc: withView(demo, ["cards", "brief"], "brief"), selectedId: null };
    case "demoBriefEdited":
      return {
        doc: apply(withView(demo, ["cards", "brief"], "brief"), [{ op: "addBriefLine", audience: "client", section: "next", text: "Launch party on Friday." }]),
        selectedId: null,
      };
    case "demoTeamView":
      return { doc: withView(demo, ["cards", "team"], "team"), selectedId: null };
    case "demoHideDone":
      return { doc: apply(demo, [{ op: "setView", patch: { hideDone: true } }]), selectedId: null };
    case "demoProgress":
      return { doc: apply(demo, [{ op: "addBlock", block: "progress" }]), selectedId: null };
    case "demoSteps":
      return {
        doc: apply(demo, [
          { op: "addTask", title: "QA pass", parentId: "t-ui", estimate: null },
          { op: "addTask", title: "Final copy", parentId: "t-ui", estimate: 1 },
        ]),
        selectedId: "t-ui",
      };
  }
}

/* ------------------------------------------------------------------
   The v2 twin
   ------------------------------------------------------------------ */

export interface Twin extends V2State {
  idMap: ReturnType<typeof migrateV0>["idMap"];
}

/** The v2 twin of a legacy state: its migration into the demo workspace (plan §7.3) */
export function twinOf(legacy: LegacyState): Twin {
  const base = demoWorkspace(FIXTURE_NOW, "Europe/Rome");
  const m = migrateV0(legacy.doc, {
    now: FIXTURE_NOW,
    mint: seededMinter(2026),
    mode: "demo",
    workspace: base,
    sample: sampleForMigration(),
    includeSampleTeam: true,
  });
  const people = { ...base.people };
  for (const p of m.people) people[p.id] = p;
  const project = m.project;
  const workspace: WorkspaceDoc = {
    ...base,
    people,
    projects: project ? { [project.id]: { id: project.id, createdAt: FIXTURE_NOW, archivedAt: null, deletedAt: null } } : {},
  };
  const local = defaultLocalViewState(project);
  if (m.local.activeView) local.activeView = m.local.activeView;
  if (legacy.selectedId !== null) local.selectedTaskId = (m.idMap.tasks[legacy.selectedId] as TaskId | undefined) ?? null;
  return { docs: { workspace, projects: project ? { [project.id]: project } : {} }, projectId: project?.id ?? null, local, idMap: m.idMap };
}

/* ------------------------------------------------------------------
   Running a command on both sides
   ------------------------------------------------------------------ */

export interface Side {
  /** What the side resolved to: control, a reply only, or applied changes */
  outcome: "control" | "reply" | "applied";
  control: string | null;
  /** The caption text: the legacy message, or the v2 caption or reply */
  caption: string;
  canonical: unknown;
}

export interface Compared {
  legacy: Side;
  v2: Side;
  /** The v2 parser's own result */
  fast: FastResult;
  legacyResult: Interpretation;
}

/**
 * What v0 showed for a parse: the store announced every view the command created ("Team · …" →
 * "Team view added · …", `store.ts` submit), on any tone.
 */
export function legacyCaption(doc: Doc, result: Interpretation): string {
  if (result.control) return result.message;
  const next = result.ops.length ? applyOperations(doc, result.ops) : doc;
  return announceView(result.message, addedViews(doc, next));
}

/** Both parsers on one command and one fixture */
export function compare(say: string, fixture: LegacyFixture): Compared {
  const legacy = legacyState(fixture);
  const twin = twinOf(legacy);
  const legacyResult = interpretDemo(say, { doc: legacy.doc, selectedId: legacy.selectedId });

  // Legacy: v0 parse → lower → runner
  let legacySide: Side;
  if (legacyResult.control) {
    legacySide = { outcome: "control", control: legacyResult.control, caption: legacyResult.message, canonical: canonical(twin) };
  } else {
    const lowered = lower(legacyResult.ops, { legacy: legacy.doc, selectedId: legacy.selectedId, state: twin.docs, projectId: twin.projectId, local: twin.local, idMap: twin.idMap, mint: seededMinter(7) });
    const r = lowered.ops.length || lowered.local.length ? run(twin, { ops: lowered.ops, local: lowered.local, notes: [], notices: [], source: "direct", text: say }) : null;
    legacySide = {
      outcome: r ? "applied" : "reply",
      control: null,
      caption: legacyCaption(legacy.doc, legacyResult),
      canonical: canonical(r ? { docs: r.state, projectId: r.projectId, local: r.local } : twin),
    };
  }

  // v2: fastParse → runner
  const fast = fastParse(say, fastContext(twin, 9));
  let v2: Side;
  if (fast.status === "none") v2 = { outcome: "reply", control: null, caption: fast.reply.text, canonical: canonical(twin) };
  else if ("control" in fast) v2 = { outcome: "control", control: fast.control, caption: legacyResult.message, canonical: canonical(twin) };
  else {
    const cmd = toCommand(fast, say);
    if (!cmd) v2 = { outcome: "reply", control: null, caption: fast.reply?.text ?? "", canonical: canonical(twin) };
    else {
      const r = run(twin, cmd);
      v2 = { outcome: "applied", control: null, caption: r.caption?.text ?? "", canonical: canonical({ docs: r.state, projectId: r.projectId, local: r.local }) };
    }
  }
  return { legacy: legacySide, v2, fast, legacyResult };
}

/* ------------------------------------------------------------------
   Canonical form
   ------------------------------------------------------------------ */

/** A state in labels: no ids, no timestamps, no order keys */
export function canonical(s: V2State): unknown {
  const ws = s.docs.workspace;
  const personName = (id: PersonId | null) => (id === null ? null : Object.hasOwn(ws.people, id) ? ws.people[id].name : `missing person`);
  const project = s.projectId !== null ? s.docs.projects[s.projectId] : null;
  const deleted = Object.values(ws.projects).filter((e) => e.deletedAt !== null).length;
  return {
    people: sortedByOrder(ws.people).map((p) => ({ name: p.name, role: p.role, capacity: p.capacityDaysPerWeek, archived: p.archived })),
    projects: { live: Object.keys(ws.projects).length - deleted, deleted },
    project: project ? canonicalProject(project, personName) : null,
    local: project
      ? { view: s.local.activeView, selected: s.local.selectedTaskId !== null ? (project.tasks[s.local.selectedTaskId]?.title ?? "missing task") : null }
      : null,
  };
}

function canonicalProject(p: ProjectDoc, personName: (id: PersonId | null) => string | null): unknown {
  const taskTitle = (id: TaskId) => (Object.hasOwn(p.tasks, id) ? p.tasks[id].title : "missing task");
  const stepLabel = (stepId: string) => {
    for (const t of Object.values(p.tasks)) {
      const step = t.steps.find((x) => x.id === stepId);
      if (step) return `${t.title}/${step.title}`;
    }
    return "missing step";
  };
  // Brief edit keys name tasks and people by id
  const keyLabel = (key: string) =>
    key
      .split(":")
      .map((seg) => (Object.hasOwn(p.tasks, seg) ? `{${taskTitle(seg as TaskId)}}` : seg.startsWith("per_") ? `{${personName(seg as PersonId)}}` : seg.startsWith("stp_") ? `{${stepLabel(seg)}}` : seg))
      .join(":");
  const proposal = p.proposal;
  return {
    title: p.title,
    kind: p.kind,
    status: p.status,
    startDate: p.startDate,
    startConfirmed: p.startConfirmed,
    members: p.memberIds.map(personName),
    views: p.views,
    blocks: p.blocks,
    viewConfig: { ...p.viewConfig, focusPin: p.viewConfig.focusPin === null ? null : taskTitle(p.viewConfig.focusPin) },
    tasks: sortedByOrder(p.tasks).map((t) => ({
      title: t.title,
      kind: t.kind,
      status: t.status,
      priority: t.priority,
      progress: t.progress,
      estimateDays: t.estimateDays,
      owner: personName(t.ownerId),
      dependsOn: t.dependsOn.map(taskTitle),
      emphasis: t.emphasis,
      costCents: t.costCents,
      steps: t.steps.map((st) => ({ title: st.title, done: st.done, estimateDays: st.estimateDays, owner: personName(st.ownerId) })),
    })),
    mood: sortedByZ(p.moodboard.items).map((m) => ({ kind: m.kind, x: m.x, y: m.y, w: m.w, h: m.h, r: m.r, hex: m.hex, text: m.text, image: m.assetId !== null })),
    brief: {
      edits: Object.keys(p.brief.edits)
        .sort()
        .map((k) => ({ key: keyLabel(k), ...p.brief.edits[k as keyof typeof p.brief.edits] })),
      lines: p.brief.lines.map((l) => ({ audience: l.audience, section: l.section, text: l.text })),
    },
    proposal:
      proposal === null
        ? null
        : proposal.kind === "subtasks"
          ? { kind: "subtasks", task: taskTitle(proposal.taskId), items: proposal.items.map((i) => ({ title: i.title, estimateDays: i.estimateDays })) }
          : proposal.kind === "reassign"
            ? {
                kind: "reassign",
                moves: proposal.moves.map((m) => (m.type === "owner" ? { task: taskTitle(m.taskId), from: personName(m.from), to: personName(m.to) } : { task: taskTitle(m.taskId), shift: m.days })),
              }
            : { kind: proposal.kind },
  };
}

/* ------------------------------------------------------------------
   Diffing
   ------------------------------------------------------------------ */

/** Paths where two canonical values differ, as "path: legacy → v2" */
export function diffValues(a: unknown, b: unknown, path = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObj = (v: unknown) => typeof v === "object" && v !== null;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.flatMap((x, i) => diffValues(x, b[i], `${path}[${i}]`));
  if (isObj(a) && isObj(b) && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])].sort();
    return keys.flatMap((k) => diffValues((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return [`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`];
}

/** The legacy and v2 control words, or the differences between the two after-states */
export function stateDiffs(c: Compared): string[] {
  const out: string[] = [];
  if (c.legacy.control !== c.v2.control) out.push(`control: ${JSON.stringify(c.legacy.control)} → ${JSON.stringify(c.v2.control)}`);
  return [...out, ...diffValues(c.legacy.canonical, c.v2.canonical)];
}
