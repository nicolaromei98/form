import { VIEW_LABEL } from "@/lib/domain/labels";
import { compareKeys } from "@/lib/domain/order";
import type { PersonId, ProjectId, TaskId } from "@/lib/domain/schema/ids";
import type { IsoDate, ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import type { CaptionEnv, CaptionFocus, CaptionLane, CaptionPlan } from "@/lib/ops/registry/_contract";

/**
 * The caption environment (plan §5.9): what captions may ask about the state after a command.
 * Every answer is lazy and memoised, so a caption that names a task never schedules the project.
 *
 * Plan, lanes and focus come from the planning engine (plan §6.5–§6.8), which lands in its own
 * lane: `CaptionPlanning` is the seam. Until the store passes the real engine, `NO_PLANNING`
 * answers "unknown" (null plan and focus, no lanes), and the captions that need it say less
 * rather than something false.
 */
export interface CaptionPlanning {
  plan(project: ProjectDoc, ws: WorkspaceDoc, today: IsoDate): CaptionPlan | null;
  /** The project's Team lanes: members, then the unassigned row (plan §6.5) */
  lanes(project: ProjectDoc, ws: WorkspaceDoc, projects: readonly ProjectDoc[], today: IsoDate): readonly CaptionLane[];
  focus(project: ProjectDoc, ws: WorkspaceDoc, today: IsoDate): CaptionFocus | null;
}

export const NO_PLANNING: CaptionPlanning = {
  plan: () => null,
  lanes: () => [],
  focus: () => null,
};

export interface CaptionState {
  readonly workspace: WorkspaceDoc;
  readonly projects: Readonly<Record<ProjectId, ProjectDoc>>;
}

export interface CaptionEnvInput {
  /** The state after the command */
  after: CaptionState;
  /** The state before it: titles of removed tasks still read */
  before?: CaptionState;
  projectId: ProjectId | null;
  today: IsoDate;
  planning?: CaptionPlanning;
}

/** Projects that count: in the index, neither archived nor deleted */
function liveProjects(state: CaptionState): ProjectDoc[] {
  return Object.keys(state.projects)
    .sort(compareKeys)
    .filter((id) => {
      const entry = state.workspace.projects[id as ProjectId];
      return !entry || (entry.archivedAt === null && entry.deletedAt === null);
    })
    .map((id) => state.projects[id as ProjectId]);
}

function lazy<T>(compute: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = compute();
      done = true;
    }
    return value;
  };
}

export function makeCaptionEnv({ after, before, projectId, today, planning = NO_PLANNING }: CaptionEnvInput): CaptionEnv {
  const ws = after.workspace;
  const project = projectId !== null && Object.hasOwn(after.projects, projectId) ? after.projects[projectId] : null;
  const previous = before && projectId !== null && Object.hasOwn(before.projects, projectId) ? before.projects[projectId] : null;

  const plan = lazy(() => (project ? planning.plan(project, ws, today) : null));
  const lanes = lazy(() => (project ? planning.lanes(project, ws, liveProjects(after), today) : []));
  const focus = lazy(() => (project ? planning.focus(project, ws, today) : null));
  const personName = (id: PersonId) => (Object.hasOwn(ws.people, id) ? ws.people[id].name : "Someone");
  const overloads = lazy(() =>
    lanes()
      .filter((l) => l.personId !== null && l.over !== null && l.over > 0)
      .map((l) => ({ personId: l.personId!, name: personName(l.personId!), over: l.over! }))
      .sort((a, b) => b.over - a.over || compareKeys(a.name, b.name)),
  );
  const openOwned = lazy(() => {
    const counts = new Map<PersonId, number>();
    for (const p of liveProjects(after)) {
      for (const t of Object.values(p.tasks)) {
        if (t.ownerId !== null && t.status !== "done") counts.set(t.ownerId, (counts.get(t.ownerId) ?? 0) + 1);
      }
    }
    return counts;
  });

  return {
    viewLabel: (v: ViewKind) => VIEW_LABEL[v],
    taskTitle(id: TaskId) {
      if (project && Object.hasOwn(project.tasks, id)) return project.tasks[id].title;
      if (previous && Object.hasOwn(previous.tasks, id)) return previous.tasks[id].title;
      return "that task";
    },
    personName,
    project: () => project,
    workspace: () => ws,
    plan,
    lanes,
    focus,
    overloads: () => overloads(),
    openTasksOwnedBy: (id: PersonId) => openOwned().get(id) ?? 0,
  };
}
