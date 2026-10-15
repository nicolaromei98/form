import { z } from "zod";
import { compareKeys, nKeys, sortedByOrder } from "@/lib/domain/order";
import { TaskId } from "@/lib/domain/schema/ids";
import { OrderKey } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { baseOf, idsInWorkflow, setIfChanged } from "@/lib/ops/registry/_helpers";

/**
 * Re-keys every task with short order keys (plan §4.4 row 66, §5.4). The command runner appends
 * it to a project commit whenever a key grows past 48 characters, with `nKeys(n)` in workflow
 * order, so it is visible in the patches and in history and replays exactly. It only re-keys:
 * it names every task once (`not_found` for a task that isn't there, `invalid_payload` for one
 * left out or a key used twice) and keeps the workflow order (`invalid_state` otherwise). A
 * system op: hidden from Activity, never in a caption, never typed or proposed.
 */
export default defineOp({
  name: "rebalanceOrder",
  scope: "project",
  schema: z.object({ op: z.literal("rebalanceOrder"), keys: z.record(TaskId, OrderKey) }).strict(),

  reduce(d, op) {
    const base: ProjectDoc = baseOf(d);
    const named = (Object.keys(op.keys) as TaskId[]).sort(compareKeys);
    if (named.some((id) => !Object.hasOwn(base.tasks, id))) return reject("not_found", "A task to re-key isn't in this project anymore.");
    if (named.length !== Object.keys(base.tasks).length) return reject("invalid_payload", "A rebalance gives every task a new key.");
    if (new Set(named.map((id) => op.keys[id])).size !== named.length) return reject("invalid_payload", "Two tasks can't share an order key.");
    const next = [...named].sort((a, b) => compareKeys(op.keys[a], op.keys[b]) || compareKeys(a, b));
    const now = idsInWorkflow(base);
    if (next.some((id, i) => id !== now[i])) return reject("invalid_state", "Re-keying must keep the workflow order.");
    for (const id of named) setIfChanged(d.tasks[id], "order", op.keys[id]);
  },

  // Folded into its commit: the runner's caption is the command's own
  caption: () => null,
  noopCaption: () => null,
  undoable: true,
  activity: "hide",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "System op: the command runner appends it, never a person or the agent." },
  palette: { exempt: "System op: the command runner appends it, never a person or the agent." },
  transport: { exempt: "System op: the command runner appends it, never a person or the agent." },
  // The demo's keys are a0–a3; a1–a4 keep the order and change every key
  sample(fx) {
    const tasks = sortedByOrder(fx.project!.tasks);
    const keys = nKeys(tasks.length + 1).slice(1);
    return { op: "rebalanceOrder", keys: Object.fromEntries(tasks.map((t, i) => [t.id, keys[i]])) };
  },
});
