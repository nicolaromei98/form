import { z } from "zod";
import { CLOSURES_MAX, RANGE_LABEL } from "@/lib/domain/limits";
import { ClosureId } from "@/lib/domain/schema/ids";
import { IsoDate, Line } from "@/lib/domain/schema/primitives";
import type { Closure } from "@/lib/domain/schema/workspace";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { ensureFreshId, part } from "@/lib/ops/registry/_helpers";
import { backwardsRange, fitsDoc, rangeText, recordBytes } from "@/lib/ops/registry/_workspace";

/**
 * Adds a studio closure or holiday to the workspace calendar (plan §4.4 row 3): no project
 * schedules work on those days unless it overrides the calendar. The producer mints the id; a
 * range that ends before it starts is refused, never swapped.
 */
export default defineOp({
  name: "addClosure",
  scope: "workspace",
  schema: z
    .object({
      op: z.literal("addClosure"),
      closure: z.object({ closureId: ClosureId, from: IsoDate, to: IsoDate, label: Line(RANGE_LABEL) }).strict(),
    })
    .strict(),

  reduce(d, op) {
    const { closureId, from, to, label } = op.closure;
    const fresh = ensureFreshId(d, closureId);
    if (fresh) return fresh;
    const backwards = backwardsRange(op.closure);
    if (backwards) return backwards;
    if (Object.keys(d.closures).length >= CLOSURES_MAX) return reject("limit", `A workspace holds at most ${CLOSURES_MAX} closures.`);
    const closure: Closure = { id: closureId, from, to, label };
    const tooLarge = fitsDoc(d, recordBytes(closureId, closure));
    if (tooLarge) return tooLarge;
    d.closures[closureId] = closure;
  },

  caption: ({ op }) => part(`Studio closed ${rangeText(op.closure.from, op.closure.to)}`),
  // A fresh id is either added or refused: adding never leaves the workspace unchanged
  noopCaption: () => null,
  undoable: true,
  activity: "show",
  idempotent: false,
  deprecates: [],
  parser: { exempt: "Closures are added in Settings; a command for them arrives with the Phase 5 parser.", until: 5 },
  palette: { exempt: "Closures are added in Settings; a palette phrase arrives with the Phase 5 parser.", until: 5 },
  transport: { exempt: "Settings only: the agent never edits workspace settings." },
  sample: (_fx, mint) => ({
    op: "addClosure",
    closure: { closureId: mint("closure"), from: "2026-12-24", to: "2027-01-06", label: "Christmas break" },
  }),
});
