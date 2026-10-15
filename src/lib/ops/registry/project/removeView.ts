import { z } from "zod";
import { VIEW_LABEL } from "@/lib/domain/labels";
import { ViewKind } from "@/lib/domain/schema/primitives";
import { defineOp, reject } from "@/lib/ops/registry/_contract";
import { part } from "@/lib/ops/registry/_helpers";

/**
 * Closes a view's tab (plan §4.4 row 48): never the data, and never the last view (`last_view`). A
 * view the project doesn't have is a no-op, so removing twice is idempotent. When the removed view
 * was on screen, the runner moves the local active view to its left neighbour (plan §5.7).
 */
export default defineOp({
  name: "removeView",
  scope: "project",
  schema: z.object({ op: z.literal("removeView"), view: ViewKind }).strict(),

  reduce(d, op) {
    const i = d.views.indexOf(op.view);
    if (i < 0) return;
    if (d.views.length === 1) {
      return reject("last_view", `The ${VIEW_LABEL[op.view]} is the project's only view: add another before removing it.`);
    }
    d.views.splice(i, 1);
  },

  caption: ({ op }) => part(`${VIEW_LABEL[op.view]} view removed · nothing in the project is deleted`),
  noopCaption: ({ op }) => `There's no ${VIEW_LABEL[op.view]} view in this project`,

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["removeView"],
  parser: { family: "view", examples: [{ say: "Remove the board", fixture: "generated60" }] },
  palette: { exempt: "The v0 palette has no remove-view phrase; the parser example covers it." },
  transport: { tool: "view", action: "remove" },
  sampleOn: "generated60",
  sample: () => ({ op: "removeView", view: "board" }),
});
