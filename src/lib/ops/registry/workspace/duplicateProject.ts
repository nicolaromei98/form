import { z } from "zod";
import { deriveId, type IdKind } from "@/lib/domain/ids";
import { docBytes } from "@/lib/domain/invariants/check";
import { BRIEF_EDIT_KEY, DOC_BYTES_MAX, PROJECT_TITLE, PROJECTS_MAX } from "@/lib/domain/limits";
import { compareKeys, sortedByOrder } from "@/lib/domain/order";
import type { IdOf } from "@/lib/domain/schema/ids";
import { ProjectId } from "@/lib/domain/schema/ids";
import { Line, type Timestamp } from "@/lib/domain/schema/primitives";
import type { BriefEdit, ProjectDoc, Task } from "@/lib/domain/schema/project";
import { defineOp, isRejection, reject } from "@/lib/ops/registry/_contract";
import { baseOf, ensureFreshId, part, title } from "@/lib/ops/registry/_helpers";
import { fitsDoc, mustIndexed, PROJECT_GONE, recordBytes } from "@/lib/ops/registry/_workspace";

/**
 * Duplicates a project (plan §4.4 row 17, Q9): an index action that commits on the workspace and
 * spawns the copy. The payload carries only the new project id; every id inside the copy is
 * derived with `deriveId(kind, newProjectId, oldId)`, so a replay derives the same ids and no id
 * map travels in the payload (plan §1.2). References follow their ids: dependencies, the focus
 * pin and the brief edits keyed to tasks or steps.
 *
 * The copy is the project as it stands, under a new title: tasks with their status, steps,
 * links and order; views, blocks and view options; the moodboard (same assets); the brief edits
 * and lines. The pending proposal and the sent-brief references stay with the original. The copy
 * and its tasks are created now; completed work keeps when it was completed.
 */

const Schema = z
  .object({ op: z.literal("duplicateProject"), sourceId: ProjectId, projectId: ProjectId, title: Line(PROJECT_TITLE) })
  .strict();
type DuplicateProject = z.infer<typeof Schema>;

/** Records in code-unit key order, so the copy never depends on how the source was built */
const valuesByKey = <T>(record: Readonly<Record<string, T>>): T[] =>
  Object.keys(record)
    .sort(compareKeys)
    .map((k) => record[k]);

function copyOf(source: ProjectDoc, op: DuplicateProject, now: Timestamp): ProjectDoc {
  const ids = new Map<string, string>();
  const derive = <K extends IdKind>(kind: K, old: string): IdOf<K> => {
    const id = deriveId(kind, op.projectId, old);
    ids.set(old, id);
    return id;
  };
  const map = <T extends string>(old: T): T => (ids.get(old) ?? old) as T;

  // Every id first, so each reference below can follow its id whatever the order
  const tasks = sortedByOrder(source.tasks);
  for (const t of tasks) {
    derive("task", t.id);
    for (const s of t.steps) derive("step", s.id);
    for (const l of t.links) derive("link", l.id);
  }
  for (const l of source.links) derive("link", l.id);
  for (const m of valuesByKey(source.moodboard.items)) derive("moodItem", m.id);
  for (const l of source.brief.lines) derive("briefLine", l.id);
  const override = source.calendarOverride;
  for (const c of valuesByKey(override?.closures ?? {})) derive("closure", c.id);

  const copiedTasks: Record<string, Task> = {};
  for (const t of tasks) {
    const id = map(t.id);
    copiedTasks[id] = {
      ...t,
      id,
      dependsOn: t.dependsOn.map(map),
      steps: t.steps.map((s) => ({ ...s, id: map(s.id) })),
      links: t.links.map((l) => ({ ...l, id: map(l.id) })),
      tags: [...t.tags],
      createdAt: now,
    };
  }
  const items: ProjectDoc["moodboard"]["items"] = {};
  for (const m of valuesByKey(source.moodboard.items)) items[map(m.id)] = { ...m, id: map(m.id) };
  let closures: NonNullable<ProjectDoc["calendarOverride"]>["closures"] = null;
  if (override?.closures) {
    closures = {};
    for (const c of valuesByKey(override.closures)) closures[map(c.id)] = { ...c, id: map(c.id) };
  }
  // "client:risks:tsk_…" follows the task; a key the longer ids push past its limit is dropped
  const edits: Record<string, BriefEdit> = {};
  for (const key of Object.keys(source.brief.edits).sort(compareKeys)) {
    const next = key.split(":").map(map).join(":");
    if (next.length <= BRIEF_EDIT_KEY) edits[next] = { ...source.brief.edits[key] };
  }
  const pin = source.viewConfig.focusPin;

  return {
    ...source,
    id: op.projectId,
    title: op.title,
    client: source.client === null ? null : { ...source.client },
    memberIds: [...source.memberIds],
    calendarOverride: override === null ? null : { workingDays: override.workingDays === null ? null : [...override.workingDays], closures },
    links: source.links.map((l) => ({ ...l, id: map(l.id) })),
    tags: [...source.tags],
    views: [...source.views],
    blocks: [...source.blocks],
    viewConfig: { ...source.viewConfig, focusPin: pin === null ? null : map(pin) },
    tasks: copiedTasks as ProjectDoc["tasks"],
    moodboard: { items },
    brief: {
      edits,
      lines: source.brief.lines.map((l) => ({ ...l, id: map(l.id) })),
      sent: [],
      sharing: { ...source.brief.sharing },
    },
    proposal: null,
    createdAt: now,
  };
}

export default defineOp({
  name: "duplicateProject",
  scope: "workspace",
  schema: Schema,

  reduce(d, op, ctx) {
    const fresh = ensureFreshId(d, op.projectId);
    if (fresh) return fresh;
    const entry = mustIndexed(baseOf(d), op.sourceId);
    if (isRejection(entry)) return entry;
    const source = ctx.readProject(op.sourceId);
    if (source === null) return reject("not_found", PROJECT_GONE);
    if (Object.keys(d.projects).length >= PROJECTS_MAX) return reject("limit", `A workspace holds at most ${PROJECTS_MAX} projects.`);
    if (docBytes(copyOf(source, op, ctx.now)) > DOC_BYTES_MAX) return reject("limit", "The copy would pass the 1 MB limit for a project.");
    const created = { id: op.projectId, createdAt: ctx.now, archivedAt: null, deletedAt: null };
    const tooLarge = fitsDoc(d, recordBytes(op.projectId, created));
    if (tooLarge) return tooLarge;
    d.projects[op.projectId] = created;
  },

  spawn(op, ctx) {
    const source = ctx.readProject(op.sourceId);
    // The recipe refused a missing source, so spawn never runs without one
    if (source === null) throw new Error(`duplicateProject spawned without its source ${op.sourceId}`);
    return copyOf(source, op, ctx.now);
  },

  caption: ({ op }) => part(`Duplicated as ${title(op.title)}`),
  // A fresh project id is either created or refused
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "An index action (\"Duplicate\" on a project row); a command for it arrives with the Phase 5 parser.", until: 5 },
  palette: { exempt: "An index action (\"Duplicate\" on a project row); a palette phrase arrives with the Phase 5 parser.", until: 5 },
  transport: { exempt: "Not exposed to the agent until the Phase 5 transport.", until: 5 },
  sample: (fx, mint) => ({
    op: "duplicateProject",
    sourceId: fx.project?.id ?? mint("project"),
    projectId: mint("project"),
    title: "New website, copy",
  }),
});
