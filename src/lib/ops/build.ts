import type { PersonId, StepId, TaskId } from "@/lib/domain/schema/ids";
import type { StepSeed, TaskSeed } from "@/lib/domain/schema/template";
import type { Op, OpOf } from "@/lib/ops/registry";

/**
 * Typed op and seed constructors (plan §2) for the producers: the parser, the store's action
 * creators, the migration and the tests. Only types come from the registry, so a module that
 * builds ops (the migration, the fast parser) never pulls the op recipes into its bundle.
 *
 * `makeOp` covers every registry op, so the step 10 families never edit this file; named
 * constructors with defaults exist for the ops producers build most.
 */

export type { Op, OpName, OpOf } from "@/lib/ops/registry";

/** Identity with the payload type checked against its op: `makeOp({ op: "removeTask", taskId })` */
export function makeOp<const P extends Op>(op: P): P {
  return op;
}

type AddTask = OpOf<"addTask">;
type UpdateTask = OpOf<"updateTask">;

/** addTask with the quick-add defaults: a task at the end, medium priority, no estimate, owner or dependencies */
export function addTaskOp(p: Pick<AddTask, "taskId" | "title"> & Partial<Omit<AddTask, "op" | "taskId" | "title">>): AddTask {
  return { op: "addTask", kind: "task", place: "end", dependsOn: [], estimateDays: null, priority: "medium", ownerId: null, ...p };
}

/** One field of a task: `updateTaskOp(id, "status", "done")` */
export function updateTaskOp<F extends UpdateTask["field"]>(taskId: TaskId, field: F, value: Extract<UpdateTask, { field: F }>["value"]): UpdateTask {
  return { op: "updateTask", taskId, field, value } as UpdateTask;
}

export function removeTaskOp(taskId: TaskId): OpOf<"removeTask"> {
  return { op: "removeTask", taskId };
}

export function addDependencyOp(taskId: TaskId, dependsOnId: TaskId): OpOf<"addDependency"> {
  return { op: "addDependency", taskId, dependsOnId };
}

export function setViewOp(patch: OpOf<"setView">["patch"]): OpOf<"setView"> {
  return { op: "setView", patch };
}

/** A step created with its task or proposed for one */
export function stepSeed(stepId: StepId, title: string, estimateDays: number | null = null): StepSeed {
  return { stepId, title, estimateDays };
}

/** A task seed for bulk creation (demo seed, template, accepted plan): To do at 0% unless given */
export function taskSeed(p: Pick<TaskSeed, "taskId" | "title"> & Partial<Omit<TaskSeed, "taskId" | "title">>): TaskSeed {
  return {
    kind: "task",
    estimateDays: null,
    dependsOn: [],
    status: "todo",
    priority: "medium",
    progress: 0,
    ownerId: null as PersonId | null,
    emphasis: false,
    steps: [],
    ...p,
  };
}
