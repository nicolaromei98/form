import { z } from "zod";
import { defineOp } from "@/lib/ops/registry/_contract";
import { part, setIfChanged } from "@/lib/ops/registry/_helpers";

/**
 * What the client's brief may show (plan §4.4 row 60). Field-shaped like the other update ops;
 * today the only field is whether the budget is shown to the client. Share links are server rows
 * (Phase 4).
 */
export default defineOp({
  name: "setBriefSharing",
  scope: "project",
  schema: z
    .object({ op: z.literal("setBriefSharing"), field: z.literal("showBudgetToClient"), value: z.boolean() })
    .strict(),

  reduce(d, op) {
    setIfChanged(d.brief.sharing, op.field, op.value);
  },

  caption: ({ op }) => part(op.value ? "Budget shown to the client" : "Budget hidden from the client"),
  noopCaption: ({ op }) => (op.value ? "The budget is already shown to the client" : "The budget is already hidden from the client"),

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Brief sharing arrives with the Phase 4 brief UI.", until: 4 },
  palette: { exempt: "Brief sharing arrives with the Phase 4 brief UI.", until: 4 },
  transport: { exempt: "Not exposed to the agent until the Phase 5 transport.", until: 5 },
  sample: () => ({ op: "setBriefSharing", field: "showBudgetToClient", value: true }),
});
