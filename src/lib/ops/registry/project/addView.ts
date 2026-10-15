import { z } from "zod";
import { VIEW_LABEL } from "@/lib/domain/labels";
import { ViewKind } from "@/lib/domain/schema/primitives";
import { defineOp, type PaletteEntry } from "@/lib/ops/registry/_contract";
import { captionKey, part } from "@/lib/ops/registry/_helpers";

/**
 * Creates a view (plan §4.4 row 47): the creating half of v0 `setRepresentation`; showing it is the
 * local `show` intent (Q6). Views are appended, so existing tabs never move, and a view the project
 * already has is a no-op (plan §5.6). There are six view kinds and each appears once, so the list
 * can't pass its limit of six. The caption part is keyed `captionKey.viewAdded(view)`, so
 * `announceView` folds it into the show caption ("Team view added · Marta over capacity").
 */

const palette = (phrase: string, rank: number): PaletteEntry => ({
  group: "Add a view",
  phrase,
  rank,
  needs: "project",
  fixture: "demo",
  surfaces: ["demo", "app"],
});

export default defineOp({
  name: "addView",
  scope: "project",
  schema: z.object({ op: z.literal("addView"), view: ViewKind }).strict(),

  reduce(d, op) {
    if (!d.views.includes(op.view)) d.views.push(op.view);
  },

  caption: ({ op }) => part(`${VIEW_LABEL[op.view]} view added`, captionKey.viewAdded(op.view)),
  // A view that is already there says nothing: "Add the tracker" on a project that has it reads as
  // the show caption alone ("Tracker"), as in v0, where opening an existing view only showed it
  noopCaption: () => null,

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["setRepresentation"],
  parser: { family: "view", examples: [{ say: "Switch to a kanban", fixture: "demo" }] },
  palette: [
    palette("Add a timeline", 10),
    palette("Add a board", 20),
    palette("Add the tracker", 30),
    palette("Add the team view", 40),
    palette("Add focus", 50),
    palette("Add a brief", 60),
  ],
  transport: { tool: "view", action: "add" },
  sample: () => ({ op: "addView", view: "timeline" }),
});
