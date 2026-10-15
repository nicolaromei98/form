import { z } from "zod";
import { WorkingDays } from "@/lib/domain/schema/primitives";
import { defineOp } from "@/lib/ops/registry/_contract";
import { part, setIfChanged } from "@/lib/ops/registry/_helpers";
import { normaliseDays, weekdaysText, wsKey } from "@/lib/ops/registry/_workspace";

/**
 * Sets the workspace's working days (plan §4.4 row 2), which every project's calendar inherits
 * unless it overrides them. The days are stored sorted and once each (plan §3.8 W3), so
 * "Fri, Mon, Mon" reads as "Mon, Fri" and a reordered list of the same days is a no-op.
 */
export default defineOp({
  name: "setWorkspaceCalendar",
  scope: "workspace",
  schema: z.object({ op: z.literal("setWorkspaceCalendar"), workingDays: WorkingDays }).strict(),

  reduce(d, op) {
    setIfChanged(d, "workingDays", normaliseDays(op.workingDays));
  },

  caption: ({ after }) => part(`Working days · ${weekdaysText(after.workingDays)}`, wsKey.workspace("workingDays")),
  noopCaption: ({ before }) => `Working days are already ${weekdaysText(before.workingDays)}`,
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Working days are set in Settings; a command for them arrives with the Phase 5 parser.", until: 5 },
  palette: { exempt: "Working days are set in Settings; a palette phrase arrives with the Phase 5 parser.", until: 5 },
  transport: { exempt: "Settings only: the agent never edits workspace settings." },
  sample: () => ({ op: "setWorkspaceCalendar", workingDays: [1, 2, 3, 4] }),
});
