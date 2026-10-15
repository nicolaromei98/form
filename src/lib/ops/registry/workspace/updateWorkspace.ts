import { z } from "zod";
import { WORKSPACE_NAME } from "@/lib/domain/limits";
import { Currency, Line, Timezone } from "@/lib/domain/schema/primitives";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { defineOp } from "@/lib/ops/registry/_contract";
import { part, setIfChanged, title } from "@/lib/ops/registry/_helpers";
import { fitsDoc, jsonBytes, wsKey } from "@/lib/ops/registry/_workspace";

/**
 * Changes one workspace setting (plan §4.4 row 1, Q12): the name, the time zone, the default
 * currency of new projects, the holiday preset or the "improve FORM" opt-in. Settings only: no
 * parser phrase until Phase 5, and never an agent call.
 */

const field = <F extends string, V extends z.ZodType>(f: F, value: V) =>
  z.object({ op: z.literal("updateWorkspace"), field: z.literal(f), value }).strict();

/** A country code ("IT"), as the workspace stores it */
const HolidayPreset = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .nullable();

type Field = "name" | "timezone" | "defaultCurrency" | "holidayPreset" | "improveFormOptIn";

/** The applied caption, from the after state */
function applied(f: Field, ws: WorkspaceDoc): string {
  switch (f) {
    case "name":
      return `Workspace renamed to ${title(ws.name)}`;
    case "timezone":
      return `Time zone · ${ws.timezone}`;
    case "defaultCurrency":
      return `Default currency · ${ws.defaultCurrency}`;
    case "holidayPreset":
      return ws.holidayPreset === null ? "Holiday preset removed" : `Holidays · ${ws.holidayPreset}`;
    case "improveFormOptIn":
      return ws.improveFormOptIn ? "Saving unsupported commands to improve FORM" : "No longer saving unsupported commands";
  }
}

/** "Already {value}" (plan §4.4), from the unchanged state */
function already(f: Field, ws: WorkspaceDoc): string {
  switch (f) {
    case "name":
      return `Already called ${title(ws.name)}`;
    case "timezone":
      return `Already on ${ws.timezone}`;
    case "defaultCurrency":
      return `Already in ${ws.defaultCurrency}`;
    case "holidayPreset":
      return ws.holidayPreset === null ? "Already without a holiday preset" : `Already on the ${ws.holidayPreset} holidays`;
    case "improveFormOptIn":
      return ws.improveFormOptIn ? "Already saving unsupported commands" : "Already not saving unsupported commands";
  }
}

export default defineOp({
  name: "updateWorkspace",
  scope: "workspace",
  schema: z.discriminatedUnion("field", [
    field("name", Line(WORKSPACE_NAME)),
    field("timezone", Timezone),
    field("defaultCurrency", Currency),
    field("holidayPreset", HolidayPreset),
    field("improveFormOptIn", z.boolean()),
  ]),

  reduce(d, op) {
    const tooLarge = fitsDoc(d, jsonBytes(op.value), jsonBytes(d[op.field]));
    if (tooLarge) return tooLarge;
    switch (op.field) {
      case "name":
        setIfChanged(d, "name", op.value);
        return;
      case "timezone":
        setIfChanged(d, "timezone", op.value);
        return;
      case "defaultCurrency":
        setIfChanged(d, "defaultCurrency", op.value);
        return;
      case "holidayPreset":
        setIfChanged(d, "holidayPreset", op.value);
        return;
      case "improveFormOptIn":
        setIfChanged(d, "improveFormOptIn", op.value);
        return;
    }
  },

  caption: ({ op, after }) => part(applied(op.field, after), wsKey.workspace(op.field)),
  noopCaption: ({ op, before }) => already(op.field, before),
  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: [],
  parser: { exempt: "Workspace settings are edited in Settings; commands for them arrive with the Phase 5 parser.", until: 5 },
  palette: { exempt: "Settings only: the palette holds project commands, never workspace settings." },
  transport: { exempt: "Settings only: the agent never edits workspace settings." },
  sample: () => ({ op: "updateWorkspace", field: "name", value: "Studio Rossi" }),
});
