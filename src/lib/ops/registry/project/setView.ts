import { z } from "zod";
import { SORT_LABEL } from "@/lib/domain/labels";
import { Audience } from "@/lib/domain/schema/primitives";
import { type ProjectDoc, type ViewConfig, ViewConfigSchema } from "@/lib/domain/schema/project";
import { type CaptionPart, defineOp } from "@/lib/ops/registry/_contract";
import { captionKey, deepEqual, part, setIfChanged, unique } from "@/lib/ops/registry/_helpers";

/**
 * View options (plan §4.4 row 49): density, layout, columns, sort, the done and urgent toggles,
 * fields, filters, and the brief's audience and length. They commit and undo, but stay out of
 * Activity (Q6). The focus pin is setFocus. The v0 coupling stays: columns without a layout pick
 * list for one column and grid otherwise.
 */

const shape = ViewConfigSchema.shape;
const optionalEach = <T extends z.ZodRawShape>(s: T) =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, (v as z.ZodType).optional()])) as unknown as {
    [K in keyof T]: z.ZodOptional<T[K]>;
  };

const FieldsPatch = z.object(optionalEach(shape.fields.shape)).strict();
const FiltersPatch = z.object(optionalEach(shape.filters.shape)).strict();

const Patch = z
  .object({
    density: shape.density.optional(),
    layout: shape.layout.optional(),
    columns: shape.columns.optional(),
    sort: shape.sort.optional(),
    hideDone: shape.hideDone.optional(),
    highlightUrgent: shape.highlightUrgent.optional(),
    fields: FieldsPatch.optional(),
    filters: FiltersPatch.optional(),
    briefAudience: Audience.optional(),
    briefShort: z.boolean().optional(),
  })
  .strict();

type Fields = ViewConfig["fields"];
type Filters = ViewConfig["filters"];
/** Fixed iteration orders, so patches and captions never depend on payload key order */
const FIELD_KEYS: readonly (keyof Fields)[] = ["priority", "estimate", "progress", "owner", "due", "cost"];
const FIELD_LABEL: Readonly<Record<keyof Fields, [shown: string, hidden: string]>> = {
  priority: ["Priority visible", "Priority hidden"],
  estimate: ["Estimates visible", "Estimates hidden"],
  progress: ["Progress bars visible", "Progress hidden"],
  owner: ["Owners visible", "Owners hidden"],
  due: ["Due dates visible", "Due dates hidden"],
  cost: ["Costs visible", "Costs hidden"],
};
const FILTER_NAME: Readonly<Record<keyof Filters, string>> = {
  ownerIds: "owner",
  statuses: "status",
  priorities: "priority",
  tags: "tag",
  due: "due date",
};
const FILTER_KEYS = Object.keys(FILTER_NAME) as (keyof Filters)[];

const sortText = (sort: ViewConfig["sort"]) => (sort === "manual" ? "Workflow order" : `Sorted by ${SORT_LABEL[sort].toLowerCase()}`);
const briefText = (brief: ViewConfig["brief"]) => `Brief for the ${brief.audience}${brief.short ? " · short version" : ""}`;
const activeFilters = (f: Filters) => FILTER_KEYS.filter((k) => (k === "due" ? f.due !== "any" : f[k].length > 0));

function viewCaption(before: ProjectDoc, after: ProjectDoc): CaptionPart[] {
  const a = after.viewConfig;
  const b = before.viewConfig;
  const key = captionKey.viewOption;
  const parts: CaptionPart[] = [];
  if (a.density !== b.density) parts.push(part(a.density === "compact" ? "Compact" : "Comfortable density", key("density")));
  if (a.columns !== b.columns && a.columns !== null) {
    parts.push(part(`${a.columns} column${a.columns > 1 ? "s" : ""}`, key("layout")));
  } else if (a.layout !== b.layout) {
    parts.push(part(a.layout === "list" ? "List" : "Grid", key("layout")));
  } else if (a.columns !== b.columns) {
    parts.push(part("Automatic columns", key("layout")));
  }
  if (a.sort !== b.sort) parts.push(part(sortText(a.sort), key("sort")));
  if (a.hideDone !== b.hideDone) parts.push(part(a.hideDone ? "Completed hidden" : "Completed visible", key("hideDone")));
  if (a.highlightUrgent !== b.highlightUrgent) parts.push(part(a.highlightUrgent ? "Urgent highlighted" : "Highlight off", key("highlightUrgent")));
  for (const k of FIELD_KEYS) {
    if (a.fields[k] !== b.fields[k]) parts.push(part(FIELD_LABEL[k][a.fields[k] ? 0 : 1], key(`fields.${k}`)));
  }
  if (!deepEqual(a.filters, b.filters)) {
    const active = activeFilters(a.filters);
    parts.push(part(active.length ? `Filtered by ${active.map((k) => FILTER_NAME[k]).join(", ")}` : "Filters cleared", key("filters")));
  }
  // The brief options share the show caption's key: "Now make it for the team" reads as the brief's own caption
  if (!deepEqual(a.brief, b.brief)) parts.push(part(briefText(a.brief), captionKey.show("brief")));
  return parts;
}

export default defineOp({
  name: "setView",
  scope: "project",
  schema: z.object({ op: z.literal("setView"), patch: Patch }).strict(),

  reduce(d, { patch }) {
    const vc = d.viewConfig;
    let layout = patch.layout;
    let columns = patch.columns;
    // v0 coupling: columns imply the layout; a grid leaves one column, and a list has none
    if (columns !== undefined && columns !== null && layout === undefined) layout = columns === 1 ? "list" : "grid";
    if (layout === "grid" && columns === undefined && vc.columns === 1) columns = null;
    if (layout === "list" && columns === undefined) columns = null;

    if (patch.density !== undefined) setIfChanged(vc, "density", patch.density);
    if (layout !== undefined) setIfChanged(vc, "layout", layout);
    if (columns !== undefined) setIfChanged(vc, "columns", columns);
    if (patch.sort !== undefined) setIfChanged(vc, "sort", patch.sort);
    if (patch.hideDone !== undefined) setIfChanged(vc, "hideDone", patch.hideDone);
    if (patch.highlightUrgent !== undefined) setIfChanged(vc, "highlightUrgent", patch.highlightUrgent);
    const fields = patch.fields;
    if (fields) {
      for (const k of FIELD_KEYS) {
        const value = fields[k];
        if (value !== undefined) setIfChanged(vc.fields, k, value);
      }
    }
    const filters = patch.filters;
    if (filters) {
      if (filters.ownerIds !== undefined) setIfChanged(vc.filters, "ownerIds", unique(filters.ownerIds));
      if (filters.statuses !== undefined) setIfChanged(vc.filters, "statuses", unique(filters.statuses));
      if (filters.priorities !== undefined) setIfChanged(vc.filters, "priorities", unique(filters.priorities));
      if (filters.tags !== undefined) setIfChanged(vc.filters, "tags", unique(filters.tags));
      if (filters.due !== undefined) setIfChanged(vc.filters, "due", filters.due);
    }
    if (patch.briefAudience !== undefined) setIfChanged(vc.brief, "audience", patch.briefAudience);
    if (patch.briefShort !== undefined) setIfChanged(vc.brief, "short", patch.briefShort);
  },

  caption: ({ before, after }) => viewCaption(before, after),

  noopCaption({ op, before }) {
    const p = op.patch;
    const vc = before.viewConfig;
    if (p.briefAudience !== undefined || p.briefShort !== undefined) {
      return `Already the ${vc.brief.audience} brief${vc.brief.short ? ", short version" : ""}`;
    }
    if (p.density !== undefined) return `The cards are already ${vc.density}`;
    if (p.columns !== undefined && p.columns !== null) return `Already ${p.columns} column${p.columns > 1 ? "s" : ""}`;
    if (p.layout !== undefined) return `Already a ${vc.layout}`;
    if (p.sort !== undefined) return vc.sort === "manual" ? "Already in workflow order" : `Already ${sortText(vc.sort).toLowerCase()}`;
    if (p.hideDone !== undefined) return vc.hideDone ? "Completed tasks are already hidden" : "Completed tasks are already visible";
    if (p.highlightUrgent !== undefined) return vc.highlightUrgent ? "Urgent tasks are already highlighted" : "Nothing is highlighted";
    return "The view already looks like that";
  },

  undoable: true,
  activity: "hide",
  idempotent: true,
  deprecates: ["setView", "setFields"],
  parser: {
    family: "layout",
    examples: [
      { say: "Sort them by name", fixture: "demo" },
      { say: "Show the cards in one column", fixture: "demo" },
    ],
  },
  palette: [
    { group: "Add a view", phrase: "Show it as a list", rank: 70, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
    { group: "Layout", phrase: "Make the cards more compact", rank: 10, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
    { group: "Layout", phrase: "Show the tasks in two columns", rank: 20, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
    { group: "Layout", phrase: "Sort them by priority", rank: 30, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
    { group: "Layout", phrase: "Hide completed tasks", rank: 40, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
    { group: "Layout", phrase: "Highlight the urgent ones", rank: 50, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
    { group: "Brief", phrase: "Now make it for the team", rank: 20, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
    { group: "Brief", phrase: "Make the brief shorter", rank: 30, needs: "project", fixture: "demo", surfaces: ["demo", "app"] },
  ],
  transport: { tool: "view_option" },
  sample: () => ({ op: "setView", patch: { density: "compact", sort: "priority" } }),
});
