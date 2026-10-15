// Property generator for rebalanceOrder, the runner's system op. `rebalancePayload` draws its
// payloads: fresh keys in workflow order (applied, unless they are the keys already there), the
// current keys (a no-op), keys that reorder the tasks, share a key, leave a task out or name a
// missing one (rejected). The unit test `registry/__tests__/tasks.test.ts` runs it as a property.
//
// The reducer suite doesn't draw it yet: its property 8 asks every applied op for a caption, and
// a system op never speaks (plan §4.4 "none (folded into its commit)"; the completeness test
// exempts it the same way). Once step 16 exempts system ops from property 8, the default export
// becomes `rebalancePayload`.
import { nKeys, nKeysBetween } from "@/lib/domain/order";
import type { OpGen } from "./_pick";
import { tasksOf } from "./_pick";

export const rebalancePayload: OpGen = (s, state, mint) => {
  const tasks = tasksOf(state);
  let keys: string[];
  switch (s.picks[0] % 6) {
    case 0:
      // The keys already there
      keys = tasks.map((t) => t.order);
      break;
    case 1:
      // Fresh keys in the reverse order
      keys = nKeys(tasks.length).reverse();
      break;
    case 2:
      // Fresh keys, two of them shared
      keys = nKeys(tasks.length).map((k, i, all) => (i === 1 ? all[0] : k));
      break;
    case 3:
      // Long keys between two neighbours, still in order
      keys = nKeysBetween("a0", "a1", tasks.length);
      break;
    default:
      // What the runner sends: nKeys(n) in workflow order
      keys = nKeys(tasks.length);
  }
  const entries: [string, string][] = tasks.map((t, i) => [t.id, keys[i]]);
  if (s.picks[1] % 12 === 0) entries.pop();
  if (s.picks[1] % 12 === 1) entries.push([mint("task"), "Zz"]);
  return { op: "rebalanceOrder", keys: Object.fromEntries(entries) };
};

const gen: OpGen = () => null;

export default gen;
