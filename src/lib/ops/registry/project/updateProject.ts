import { z } from "zod";
import { applyRequireReview } from "@/lib/domain/invariants/transitions";
import { PROJECT_KIND_LABEL, PROJECT_STATUS_LABEL } from "@/lib/domain/labels";
import { CLOSURES_MAX } from "@/lib/domain/limits";
import { formatMoney } from "@/lib/domain/money";
import { compareKeys, sortedByOrder } from "@/lib/domain/order";
import type { ClosureId } from "@/lib/domain/schema/ids";
import { type CalendarOverride, type ProjectDoc, ProjectDocSchema } from "@/lib/domain/schema/project";
import type { Closure } from "@/lib/domain/schema/workspace";
import { defineOp, isRejection, type Rejection, reject } from "@/lib/ops/registry/_contract";
import { mustActivePerson, part, setIfChanged, shortDate, title, unique } from "@/lib/ops/registry/_helpers";
import { count, ensureMember, weekdaysText } from "@/lib/ops/registry/_tasks";

/**
 * Changes one field of the project (plan §4.4 row 21; v0 renameTool, and setStartDate lowered to
 * startDate then startConfirmed). Each field keeps the document's rules:
 * - the start never falls after the deadline (`invalid_state`);
 * - the lead is someone in the workspace, not archived, who joins the members;
 * - turning the review step off makes every task In review at 100% Done (plan §5.5), named in
 *   the caption;
 * - the calendar override keeps its working days sorted and unique, files each closure under its
 *   own id, refuses a closure that ends before it starts, and becomes null when it overrides
 *   nothing;
 * - tags are deduplicated on write.
 */

const shape = ProjectDocSchema.shape;
const field = <F extends string, V extends z.ZodType>(f: F, value: V) =>
  z.object({ op: z.literal("updateProject"), field: z.literal(f), value }).strict();

/** The start and its confirmation share a caption key: "Start · 28 Sep · confirmed" reads once */
const START_KEY = "project:start";

/** The override as stored: sorted working days, closures re-filed in key order, null when it overrides nothing */
function normaliseOverride(value: CalendarOverride | null): CalendarOverride | null | Rejection {
  if (value === null) return null;
  const workingDays = value.workingDays === null ? null : unique(value.workingDays).sort((a, b) => a - b);
  let closures: Record<ClosureId, Closure> | null = null;
  if (value.closures !== null) {
    const keys = (Object.keys(value.closures) as ClosureId[]).sort(compareKeys);
    if (keys.length > CLOSURES_MAX) return reject("limit", `A calendar holds at most ${CLOSURES_MAX} closures.`);
    // Closure ids can only meet each other inside a project document, so being filed under its own id is enough
    closures = {};
    for (const key of keys) {
      const c = value.closures[key];
      if (c.id !== key) return reject("invalid_payload", "A closure is filed under another closure's id.");
      if (c.from > c.to) return reject("invalid_payload", "A closure ends before it starts.");
      closures[key] = { id: c.id, from: c.from, to: c.to, label: c.label };
    }
  }
  if (workingDays === null && closures === null) return null;
  return { workingDays, closures };
}

function overrideText(o: CalendarOverride | null): string {
  const days = o?.workingDays ? `Working days · ${weekdaysText(o.workingDays)}` : "Working days · same as workspace";
  if (!o?.closures) return days;
  const n = Object.keys(o.closures).length;
  return `${days} · ${n === 0 ? "no closures" : count(n, "closure")}`;
}

/** Tasks In review at 100% before the review step went off: the ones it made Done */
const reviewedDone = (before: ProjectDoc) => sortedByOrder(before.tasks).filter((t) => t.status === "review" && t.progress === 100);

export default defineOp({
  name: "updateProject",
  scope: "project",
  schema: z.discriminatedUnion("field", [
    field("title", shape.title),
    field("client", shape.client),
    field("kind", shape.kind),
    field("goal", shape.goal),
    field("status", shape.status),
    field("startDate", shape.startDate),
    field("startConfirmed", shape.startConfirmed),
    field("deadline", shape.deadline),
    field("deadlineKind", shape.deadlineKind),
    field("currency", shape.currency),
    field("budgetCents", shape.budgetCents),
    field("leadId", shape.leadId),
    field("requireReview", shape.requireReview),
    field("autoChain", shape.autoChain),
    field("calendarOverride", shape.calendarOverride),
    field("tags", shape.tags),
  ]),

  reduce(d, op, ctx) {
    switch (op.field) {
      case "title":
        setIfChanged(d, "title", op.value);
        return;
      case "client":
        setIfChanged(d, "client", op.value);
        return;
      case "kind":
        setIfChanged(d, "kind", op.value);
        return;
      case "goal":
        setIfChanged(d, "goal", op.value);
        return;
      case "status":
        setIfChanged(d, "status", op.value);
        return;
      case "startDate":
        if (op.value !== null && d.deadline !== null && op.value > d.deadline) {
          return reject("invalid_state", `The start can't be after the deadline (${shortDate(d.deadline)}).`);
        }
        setIfChanged(d, "startDate", op.value);
        return;
      case "startConfirmed":
        setIfChanged(d, "startConfirmed", op.value);
        return;
      case "deadline":
        if (op.value !== null && d.startDate !== null && op.value < d.startDate) {
          return reject("invalid_state", `The deadline can't be before the start (${shortDate(d.startDate)}).`);
        }
        setIfChanged(d, "deadline", op.value);
        return;
      case "deadlineKind":
        setIfChanged(d, "deadlineKind", op.value);
        return;
      case "currency":
        setIfChanged(d, "currency", op.value);
        return;
      case "budgetCents":
        setIfChanged(d, "budgetCents", op.value);
        return;
      case "leadId":
        if (op.value !== null) {
          const person = mustActivePerson(ctx.workspace, op.value);
          if (isRejection(person)) return person;
          const member = ensureMember(d, op.value);
          if (member) return member;
        }
        setIfChanged(d, "leadId", op.value);
        return;
      case "requireReview":
        applyRequireReview(d, op.value, ctx.now);
        return;
      case "autoChain":
        setIfChanged(d, "autoChain", op.value);
        return;
      case "calendarOverride": {
        const next = normaliseOverride(op.value);
        if (isRejection(next)) return next;
        setIfChanged(d, "calendarOverride", next);
        return;
      }
      case "tags":
        setIfChanged(d, "tags", unique(op.value));
        return;
    }
  },

  caption({ op, before, after, env }) {
    const key = `project:${op.field}`;
    switch (op.field) {
      case "title":
        return part(`Renamed to ${title(after.title)}`, key);
      case "client": {
        const name = after.client?.name ?? after.client?.contactName ?? null;
        return part(after.client === null ? "Client removed" : name ? `Client · ${title(name)}` : "Client details updated", key);
      }
      case "kind":
        return part(`Project type · ${PROJECT_KIND_LABEL[after.kind]}`, key);
      case "goal":
        return part(after.goal === null ? "Goal cleared" : "Goal updated", key);
      case "status":
        return part(`Project · ${PROJECT_STATUS_LABEL[after.status]}`, key);
      case "startDate":
        return part(after.startDate === null ? "Start date cleared" : `Start · ${shortDate(after.startDate)}`, START_KEY);
      case "startConfirmed":
        if (!after.startConfirmed) return part("Start date not confirmed", START_KEY);
        return part(after.startDate === null ? "Start date confirmed" : `Start · ${shortDate(after.startDate)} · confirmed`, START_KEY);
      case "deadline":
        return part(after.deadline === null ? "Deadline cleared" : `Deadline · ${shortDate(after.deadline)}`, key);
      case "deadlineKind":
        return part(after.deadlineKind === "hard" ? "Hard deadline" : "Soft deadline", key);
      case "currency":
        return part(`Currency · ${after.currency}`, key);
      case "budgetCents":
        return part(after.budgetCents === null ? "Budget cleared" : `Budget · ${formatMoney(after.budgetCents, after.currency)}`, key);
      case "leadId":
        return part(after.leadId === null ? "No lead" : `Lead · ${title(env.personName(after.leadId))}`, key);
      case "requireReview": {
        if (after.requireReview) return part("Review step on", key);
        const done = reviewedDone(before);
        if (done.length === 0) return part("Review step off", key);
        return part(`Review step off · ${done.length === 1 ? title(done[0].title) : count(done.length, "task")} → Done`, key);
      }
      case "autoChain":
        return part(after.autoChain ? "New tasks follow the last one" : "New tasks start unlinked", key);
      case "calendarOverride":
        return part(overrideText(after.calendarOverride), key);
      case "tags":
        return part(after.tags.length ? `Project tagged ${after.tags.join(", ")}` : "Project tags cleared", key);
    }
  },

  noopCaption({ op, before, env }) {
    switch (op.field) {
      case "title":
        return `It's already called ${title(before.title)}`;
      case "client":
        return before.client === null ? "The project has no client" : "The client details are unchanged";
      case "kind":
        return `The project type is already ${PROJECT_KIND_LABEL[before.kind]}`;
      case "goal":
        return before.goal === null ? "The project has no goal yet" : "The goal is unchanged";
      case "status":
        return `The project status is already ${PROJECT_STATUS_LABEL[before.status]}`;
      case "startDate":
        return before.startDate === null ? "The project has no start date" : `The project already starts ${shortDate(before.startDate)}`;
      case "startConfirmed":
        return before.startConfirmed ? "The start is already confirmed" : "The start isn't confirmed";
      case "deadline":
        return before.deadline === null ? "The project has no deadline" : `The deadline is already ${shortDate(before.deadline)}`;
      case "deadlineKind":
        return `The deadline is already ${before.deadlineKind}`;
      case "currency":
        return `The project is already in ${before.currency}`;
      case "budgetCents":
        return before.budgetCents === null ? "The project has no budget" : `The budget is already ${formatMoney(before.budgetCents, before.currency)}`;
      case "leadId":
        return before.leadId === null ? "The project has no lead" : `${title(env.personName(before.leadId))} already leads the project`;
      case "requireReview":
        return before.requireReview ? "The review step is already on" : "The review step is already off";
      case "autoChain":
        return before.autoChain ? "New tasks already follow the last one" : "New tasks already start unlinked";
      case "calendarOverride":
        return before.calendarOverride === null ? "The working days already follow the workspace" : "The working days are unchanged";
      case "tags":
        return "The project's tags are unchanged";
    }
  },

  undoable: true,
  activity: "show",
  idempotent: true,
  deprecates: ["renameTool", "setStartDate"],
  parser: { exempt: "Project fields are direct edits until the Phase 5 parser understands them.", until: 5 },
  palette: { exempt: "Project fields are direct edits; no palette phrase until Phase 5.", until: 5 },
  transport: { tool: "project_edit" },
  sample: () => ({ op: "updateProject", field: "title", value: "Studio site" }),
});
