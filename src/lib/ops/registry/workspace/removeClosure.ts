import { z } from "zod";
import { compareKeys } from "@/lib/domain/order";
import { ClosureId } from "@/lib/domain/schema/ids";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { part } from "@/lib/ops/registry/_helpers";

/**
 * Removes a closure from the workspace calendar (plan §4.4 row 4). The days become working days
 * again for every project that inherits the calendar.
 */
export default defineOp({
  name: "removeClosure",
  scope: "workspace",
  schema: z.object({ op: z.literal("removeClosure"), closureId: ClosureId }).strict(),

  reduce(d, op) {
    if (!Object.hasOwn(d.closures, op.closureId)) return reject("not_found", "That closure isn't on the calendar anymore.");
    delete d.closures[op.closureId];
  },

  caption: () => part("Closure removed"),
  // A closure is either there to remove or not_found
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Closures are removed in Settings; a command for them arrives with the Phase 5 parser.", until: 5 },
  palette: { exempt: "Closures are removed in Settings; a palette phrase arrives with the Phase 5 parser.", until: 5 },
  transport: { exempt: "Settings only: the agent never edits workspace settings." },
  // The first closure on the calendar; a fresh id when the fixture has none (it then refuses)
  sample: (fx, mint) => ({
    op: "removeClosure",
    closureId: Object.keys(fx.workspace.closures).sort(compareKeys)[0] ?? mint("closure"),
  }),
  sampleOn: "demoExtras",
});
