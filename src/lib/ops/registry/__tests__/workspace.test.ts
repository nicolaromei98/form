// Step 10d (plan §11 row 10): the workspace ops and the project index. For every op: the happy
// path with its exact caption, the no-op by reference with its noopCaption, every rejection it can
// produce, and undo by patches. createProject and duplicateProject also spawn their project in
// the same command; deletePerson is the only producer of owns_tasks (Q8).
import fc from "fast-check";
import { applyPatches, type Patch } from "immer";
import { describe, expect, it } from "vitest";
import { deriveId, type IdKind, seededMinter } from "@/lib/domain/ids";
import { checkProject, checkWorkspace, docBytes } from "@/lib/domain/invariants/check";
import {
  CLOSURES_MAX,
  DOC_BYTES_MAX,
  PEOPLE_MAX,
  PROJECTS_MAX,
  STEP_TITLE,
  STEPS_MAX,
  TEMPLATE_TASKS_MAX,
  TEMPLATES_MAX,
  TIME_OFF_MAX,
} from "@/lib/domain/limits";
import { nKeys } from "@/lib/domain/order";
import type { PersonId, ProjectId, TaskId, TemplateId } from "@/lib/domain/schema/ids";
import { IsoDate } from "@/lib/domain/schema/primitives";
import { type ProjectDoc, ProjectDocSchema } from "@/lib/domain/schema/project";
import type { TemplateTask } from "@/lib/domain/schema/template";
import { type WorkspaceDoc, WorkspaceDocSchema } from "@/lib/domain/schema/workspace";
import { taskSeed } from "@/lib/ops/build";
import { applyOp } from "@/lib/ops/reduce";
import { REGISTRY } from "@/lib/ops/registry";
import {
  byId,
  DEMO_PEOPLE,
  demoState,
  emptyState,
  FIXTURE_NOW,
  indexEntry,
  makePerson,
  makeProject,
  makeTask,
  taskByTitle,
} from "../../../../../test/fixtures/v2/build";
import { GENERATORS } from "../../../../../test/property/gen";
import type { GenState, StepIntent } from "../../../../../test/property/gen/_pick";
import { spawning as createProjectGen } from "../../../../../test/property/gen/createProject";
import { spawning as duplicateProjectGen } from "../../../../../test/property/gen/duplicateProject";
import { startState } from "../../../../../test/property/materialise";
import {
  apply,
  captionOf,
  deepFreeze,
  expectApplied,
  expectInverse,
  expectNoop,
  expectRejection,
  projectOf,
  run,
  type TestState,
  withDoc,
} from "./support";

const mint = seededMinter(1010);
const demo = (): TestState => deepFreeze(demoState());
const empty = (): TestState => deepFreeze(emptyState());
const wsOf = (r: { result: { doc: unknown } }) => r.result.doc as WorkspaceDoc;
const { marta, sara, luca } = DEMO_PEOPLE;

/** A state whose workspace is edited by `edit` */
function withWs(state: TestState, edit: (ws: WorkspaceDoc) => WorkspaceDoc): TestState {
  return deepFreeze({ ...state, workspace: edit(state.workspace) });
}

/** A state with one person edited */
const withPerson = (state: TestState, id: PersonId, edit: Partial<WorkspaceDoc["people"][PersonId]>) =>
  withWs(state, (ws) => ({ ...ws, people: { ...ws.people, [id]: { ...ws.people[id], ...edit } } }));

/** Runs ops as one command that must change something, and returns the state after it */
function after(state: TestState, ...ops: unknown[]): TestState {
  const r = run(state, ops);
  expect(r.changed, JSON.stringify(r.outcomes.map((o) => (o.result.kind === "rejected" ? o.result.rejection : o.result.kind)))).toBe(true);
  return deepFreeze({ workspace: r.state.workspace, projects: { ...r.state.projects }, projectId: r.projectId ?? state.projectId });
}

/** The tone and undo flag of a no-op caption */
const noop = (text: string) => ({ text, tone: "info", undoable: false });

/* ------------------------------------------------------------------
   Payload builders
   ------------------------------------------------------------------ */

const update = (field: string, value: unknown) => ({ op: "updateWorkspace", field, value });

const closure = (o: Record<string, unknown> = {}) => ({
  op: "addClosure",
  closure: { closureId: mint("closure"), from: "2026-12-24", to: "2027-01-06", label: "Christmas break", ...o },
});

const person = (o: Record<string, unknown> = {}) => ({
  op: "addPerson",
  personId: mint("person"),
  name: "Giulia",
  role: null,
  email: null,
  capacityDaysPerWeek: null,
  dayRateCents: null,
  ...o,
});

const updatePerson = (personId: PersonId, field: string, value: unknown) => ({ op: "updatePerson", personId, field, value });

const timeOff = (personId: PersonId, o: Record<string, unknown> = {}) => ({
  op: "addTimeOff",
  personId,
  timeOff: { timeOffId: mint("timeOff"), from: "2026-11-02", to: "2026-11-06", label: null, ...o },
});

const templateTask = (o: Partial<TemplateTask> = {}): TemplateTask => ({
  title: "Research",
  kind: "task",
  estimateDays: null,
  dependsOn: [],
  steps: [],
  roleHint: null,
  ...o,
});

const template = (o: Record<string, unknown> = {}, tasks: TemplateTask[] = [templateTask()]) => ({
  op: "saveTemplate",
  template: { templateId: mint("template"), name: "Website, four phases", kind: "website", tasks, ...o },
});

function draft(o: Record<string, unknown> = {}) {
  return {
    title: "Ceramica Bassi",
    client: null,
    kind: "website",
    goal: null,
    startDate: null,
    startConfirmed: false,
    deadline: null,
    deadlineKind: "soft",
    currency: "EUR",
    budgetCents: null,
    leadId: null,
    memberIds: [],
    requireReview: false,
    autoChain: true,
    calendarOverride: null,
    links: [],
    tags: [],
    startAs: "cards",
    ...o,
  };
}

const create = (o: Record<string, unknown> = {}, tasks: unknown[] = []) => ({
  op: "createProject",
  projectId: mint("project"),
  draft: draft(o),
  tasks,
});

/** The demo template as seeds: Research → Visual Direction → UI Design → Development */
function demoSeeds() {
  const [research, visual, ui, dev] = [mint("task"), mint("task"), mint("task"), mint("task")];
  return [
    taskSeed({ taskId: research, title: "Research", status: "done", progress: 100, estimateDays: 3, ownerId: sara, priority: "low" }),
    taskSeed({ taskId: visual, title: "Visual Direction", status: "review", progress: 85, estimateDays: 4, ownerId: marta, dependsOn: [research] }),
    taskSeed({ taskId: ui, title: "UI Design", status: "active", progress: 30, estimateDays: 6, ownerId: marta, dependsOn: [visual, visual] }),
    taskSeed({ taskId: dev, title: "Development", status: "todo", progress: 0, estimateDays: 8, ownerId: luca, dependsOn: [ui] }),
  ];
}

/** A second, inactive project on the demo workspace */
function twoProjects(): TestState {
  const s = demoState();
  const other = makeProject({ id: mint("project"), workspaceId: s.workspace.id, title: "Ceramica Bassi" });
  return deepFreeze({
    workspace: { ...s.workspace, projects: { ...s.workspace.projects, [other.id]: indexEntry(other.id) } },
    projects: { ...s.projects, [other.id]: other },
    projectId: s.projectId,
  });
}

const otherProjectId = (s: TestState) => (Object.keys(s.projects) as ProjectId[]).find((id) => id !== s.projectId)!;

/**
 * A valid workspace whose JSON stays within `spare` bytes of the 1 MB limit, padded with
 * templates of long step titles. Bytes grow with every character, so a binary search finds it.
 */
function nearlyFull(base: WorkspaceDoc, spare: number): WorkspaceDoc {
  const perTemplate = TEMPLATE_TASKS_MAX * STEPS_MAX * STEP_TITLE;
  const ids = [mint("template"), mint("template")];
  const make = (chars: number): WorkspaceDoc => {
    const templates = { ...base.templates };
    let left = chars;
    ids.forEach((id, k) => {
      const tasks: TemplateTask[] = [];
      let here = Math.min(left, perTemplate);
      left -= here;
      while (here > 0) {
        const steps: string[] = [];
        while (here > 0 && steps.length < STEPS_MAX) {
          const n = Math.min(STEP_TITLE, here);
          steps.push("x".repeat(n));
          here -= n;
        }
        tasks.push(templateTask({ title: `Pad ${tasks.length + 1}`, steps }));
      }
      if (tasks.length > 0) templates[id] = { id, name: `Padding ${k + 1}`, kind: "other", tasks, createdAt: FIXTURE_NOW };
    });
    return { ...base, templates };
  };
  let lo = 0;
  let hi = 2 * perTemplate;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (docBytes(make(mid)) <= DOC_BYTES_MAX - spare) lo = mid;
    else hi = mid - 1;
  }
  return make(lo);
}

const FULL = new Map<number, TestState>();
/** The demo with a workspace about `spare` bytes short of the limit (built once per spare) */
function fullDemo(spare = 100): TestState {
  let s = FULL.get(spare);
  if (!s) {
    s = withWs(demo(), (ws) => nearlyFull(ws, spare));
    FULL.set(spare, s);
  }
  return s;
}

/* ------------------------------------------------------------------
   updateWorkspace
   ------------------------------------------------------------------ */

describe("updateWorkspace", () => {
  it("renames the workspace and says so", () => {
    const s = demo();
    const r = apply(s, update("name", "Studio Rossi"));
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).name).toBe("Studio Rossi");
    expect(captionOf(s, update("name", "Studio Rossi"))).toBe("Workspace renamed to Studio Rossi");
  });

  it("captions every setting from the after state", () => {
    const s = demo();
    expect(captionOf(s, update("timezone", "Pacific/Auckland"))).toBe("Time zone · Pacific/Auckland");
    expect(captionOf(s, update("defaultCurrency", "USD"))).toBe("Default currency · USD");
    expect(captionOf(s, update("holidayPreset", "IT"))).toBe("Holidays · IT");
    expect(captionOf(s, update("improveFormOptIn", true))).toBe("Saving unsupported commands to improve FORM");
    const set = after(s, update("holidayPreset", "IT"), update("improveFormOptIn", true));
    expect(captionOf(set, update("holidayPreset", null))).toBe("Holiday preset removed");
    expect(captionOf(set, update("improveFormOptIn", false))).toBe("No longer saving unsupported commands");
  });

  it("reads two edits of one setting as the last one", () => {
    expect(run(demo(), [update("name", "Studio A"), update("name", "Studio B")]).caption?.text).toBe("Workspace renamed to Studio B");
  });

  it("is a no-op, by reference, for the same value", () => {
    const s = demo();
    expect(REGISTRY.get("updateWorkspace")!.idempotent).toBe(true);
    const r = apply(s, update("name", "Demo studio"));
    expectNoop(r.result, r.before);
    expect(run(s, [update("name", "Demo studio")]).caption).toEqual(noop("Already called Demo studio"));
    expect(captionOf(s, update("timezone", "Europe/Rome"))).toBe("Already on Europe/Rome");
    expect(captionOf(s, update("defaultCurrency", "EUR"))).toBe("Already in EUR");
    expect(captionOf(s, update("holidayPreset", null))).toBe("Already without a holiday preset");
    expect(captionOf(s, update("improveFormOptIn", false))).toBe("Already not saving unsupported commands");
  });

  it("refuses invalid values, the wrong document, and a name that would pass 1 MB", () => {
    const s = demo();
    expectRejection(apply(s, update("timezone", "Mars/Olympus")).result, "invalid_payload");
    expectRejection(apply(s, update("holidayPreset", "ITA")).result, "invalid_payload");
    expectRejection(apply(s, update("name", "  Studio")).result, "invalid_payload");
    expectRejection(apply(s, update("name", "x".repeat(61))).result, "invalid_payload");
    expectRejection(apply(s, update("colour", "red")).result, "invalid_payload");
    // A workspace op never applies to a project document
    const wrong = applyOp(projectOf(s), update("name", "Studio Rossi"), {
      now: FIXTURE_NOW,
      actorId: null,
      source: "direct",
      workspace: s.workspace,
      readProject: () => null,
      ownership: () => 0,
    });
    expectRejection(wrong, "wrong_scope");
    // 20 bytes short: seven more characters fit, 49 don't
    const f = fullDemo(20);
    expectApplied(apply(f, update("name", "Demo studio, Milan")).result);
    const big = expectRejection(apply(f, update("name", "x".repeat(60))).result, "limit");
    expect(big.message).toBe("That would take the workspace past its 1 MB limit.");
  }, 20_000);
});

/* ------------------------------------------------------------------
   setWorkspaceCalendar
   ------------------------------------------------------------------ */

describe("setWorkspaceCalendar", () => {
  const calendar = (workingDays: unknown) => ({ op: "setWorkspaceCalendar", workingDays });

  it("stores the working days sorted and once each", () => {
    const s = demo();
    const r = apply(s, calendar([4, 1, 2, 3, 3]));
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).workingDays).toEqual([1, 2, 3, 4]);
    expect(captionOf(s, calendar([4, 1, 2, 3, 3]))).toBe("Working days · Mon–Thu");
    expect(captionOf(s, calendar([1, 3, 5]))).toBe("Working days · Mon, Wed, Fri");
    expect(captionOf(s, calendar([6, 7, 1, 2, 3]))).toBe("Working days · Mon–Wed, Sat, Sun");
    expect(captionOf(s, calendar([1, 2, 3, 4, 5, 6, 7]))).toBe("Working days · Mon–Sun");
  });

  it("is a no-op for the same days in any order", () => {
    const s = demo();
    const r = apply(s, calendar([5, 4, 3, 2, 1, 1]));
    expectNoop(r.result, r.before);
    expect(captionOf(s, calendar([5, 4, 3, 2, 1]))).toBe("Working days are already Mon–Fri");
  });

  it("refuses no days and days outside the week", () => {
    const s = demo();
    expectRejection(apply(s, calendar([])).result, "invalid_payload");
    expectRejection(apply(s, calendar([0, 1])).result, "invalid_payload");
    expectRejection(apply(s, calendar([1, 8])).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   addClosure and removeClosure
   ------------------------------------------------------------------ */

describe("addClosure", () => {
  it("adds a closure to the workspace calendar", () => {
    const s = demo();
    const op = closure();
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    const id = op.closure.closureId;
    expect(wsOf(r).closures[id]).toEqual({ id, from: "2026-12-24", to: "2027-01-06", label: "Christmas break" });
    expect(captionOf(s, op)).toBe("Studio closed 24 Dec–6 Jan");
    expect(captionOf(s, closure({ from: "2026-11-02", to: "2026-11-06" }))).toBe("Studio closed 2–6 Nov");
    expect(captionOf(s, closure({ from: "2026-12-08", to: "2026-12-08" }))).toBe("Studio closed 8 Dec");
    expect(captionOf(s, closure({ from: "2026-11-02", to: "2027-11-06" }))).toBe("Studio closed 2 Nov 2026–6 Nov 2027");
  });

  it("refuses a taken id (not idempotent), a backwards range and a 201st closure", () => {
    const s = demo();
    const op = closure();
    expect(REGISTRY.get("addClosure")!.idempotent).toBe(false);
    expectRejection(apply(after(s, op), op).result, "duplicate_id");
    const back = expectRejection(apply(s, closure({ from: "2026-12-24", to: "2026-12-20" })).result, "invalid_payload");
    expect(back.message).toBe("A date range ends on or after the day it starts.");
    expectRejection(apply(s, closure({ from: "2026-02-30" })).result, "invalid_payload");
    expectRejection(apply(s, closure({ label: "" })).result, "invalid_payload");
    const many = withWs(s, (ws) => {
      const day = IsoDate.parse("2027-03-01");
      const list = Array.from({ length: CLOSURES_MAX }, (_, i) => ({ id: mint("closure"), from: day, to: day, label: `Day ${i + 1}` }));
      return { ...ws, closures: byId(list) };
    });
    const limit = expectRejection(apply(many, closure()).result, "limit");
    expect(limit.message).toBe("A workspace holds at most 200 closures.");
    expectRejection(apply(fullDemo(), closure()).result, "limit");
  }, 20_000);
});

describe("removeClosure", () => {
  it("removes a closure, and refuses one that isn't there (not idempotent)", () => {
    const add = closure();
    const s = after(demo(), add);
    const op = { op: "removeClosure", closureId: add.closure.closureId };
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).closures).toEqual({});
    expect(captionOf(s, op)).toBe("Closure removed");
    expect(REGISTRY.get("removeClosure")!.idempotent).toBe(false);
    const gone = expectRejection(apply(after(s, op), op).result, "not_found");
    expect(gone.message).toBe("That closure isn't on the calendar anymore.");
  });
});

/* ------------------------------------------------------------------
   addPerson
   ------------------------------------------------------------------ */

describe("addPerson", () => {
  it("adds a person below every Team row, and says the capacity isn't set (Q3)", () => {
    const s = demo();
    const op = person({ role: "Designer", email: "giulia@studio.it" });
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).people[op.personId as PersonId]).toEqual({
      id: op.personId,
      name: "Giulia",
      role: "Designer",
      email: "giulia@studio.it",
      userId: null,
      capacityDaysPerWeek: null,
      dayRateCents: null,
      timeOff: {},
      order: nKeys(4)[3],
      archived: false,
      createdAt: FIXTURE_NOW,
    });
    expect(captionOf(s, op)).toBe("Giulia added to the team · capacity not set");
  });

  it("states a capacity the producer gives", () => {
    const s = demo();
    expect(captionOf(s, person({ capacityDaysPerWeek: 5 }))).toBe("Giulia added to the team · 5 days a week");
    expect(captionOf(s, person({ capacityDaysPerWeek: 1 }))).toBe("Giulia added to the team · 1 day a week");
    expect(captionOf(s, person({ capacityDaysPerWeek: 0.5 }))).toBe("Giulia added to the team · 0.5 days a week");
  });

  it("says people added alike once, and their joining the project goes without saying (caption policy rules 1 and 2)", () => {
    const s = demo();
    const [giulia, paolo] = [person({ name: "Giulia" }), person({ name: "Paolo" })];
    expect(run(s, [giulia, paolo]).caption?.text).toBe("Giulia and Paolo added to the team · capacity not set");
    const joining = [giulia, paolo, { op: "addMember", personId: giulia.personId }, { op: "addMember", personId: paolo.personId }];
    expect(run(s, joining).caption?.text).toBe("Giulia and Paolo added to the team · capacity not set");
    // Different capacities are different sentences
    expect(run(s, [giulia, person({ name: "Paolo", capacityDaysPerWeek: 4 })]).caption?.text).toBe(
      "Giulia added to the team · capacity not set · Paolo added to the team · 4 days a week",
    );
  });

  it("starts the Team rows in an empty workspace", () => {
    const r = apply(empty(), person());
    expect(Object.values(wsOf(r).people)[0].order).toBe(nKeys(1)[0]);
  });

  it("is a no-op for a name already in the team, whatever its case, so a second add is too", () => {
    const s = demo();
    const r = apply(s, person({ name: "marta" }));
    expectNoop(r.result, r.before);
    expect(run(s, [person({ name: "marta" })]).caption).toEqual(noop("Marta is already in the team"));
    expect(REGISTRY.get("addPerson")!.idempotent).toBe(true);
    const op = person();
    const again = apply(after(s, op), op);
    expectNoop(again.result, again.before);
  });

  it("adds someone new under an archived person's name", () => {
    const s = withPerson(demo(), luca, { archived: true });
    expect(captionOf(s, person({ name: "Luca" }))).toBe("Luca added to the team · capacity not set");
  });

  it("refuses a taken id, invalid fields, a 101st person and a workspace past 1 MB", () => {
    const s = demo();
    expectRejection(apply(s, person({ personId: marta })).result, "duplicate_id");
    expectRejection(apply(s, person({ capacityDaysPerWeek: 7.5 })).result, "invalid_payload");
    expectRejection(apply(s, person({ capacityDaysPerWeek: 2.7 })).result, "invalid_payload");
    expectRejection(apply(s, person({ name: "x".repeat(41) })).result, "invalid_payload");
    expectRejection(apply(s, person({ email: "not an email" })).result, "invalid_payload");
    const crowd = withWs(empty(), (ws) => {
      const orders = nKeys(PEOPLE_MAX);
      return { ...ws, people: byId(orders.map((order, i) => makePerson({ id: mint("person"), name: `Person ${i + 1}`, order }))) };
    });
    const limit = expectRejection(apply(crowd, person()).result, "limit");
    expect(limit.message).toBe("A workspace holds at most 100 people.");
    expectRejection(apply(fullDemo(), person()).result, "limit");
  }, 20_000);
});

/* ------------------------------------------------------------------
   updatePerson
   ------------------------------------------------------------------ */

describe("updatePerson", () => {
  it("sets a weekly capacity", () => {
    const s = demo();
    const op = updatePerson(marta, "capacityDaysPerWeek", 4);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).people[marta].capacityDaysPerWeek).toBe(4);
    expect(captionOf(s, op)).toBe("Marta · 4 days a week");
  });

  it("captions every field", () => {
    const s = demo();
    expect(captionOf(s, updatePerson(marta, "capacityDaysPerWeek", null))).toBe("Marta · capacity not set");
    expect(captionOf(s, updatePerson(marta, "name", "Martina"))).toBe("Marta renamed to Martina");
    expect(captionOf(s, updatePerson(marta, "role", "Creative director"))).toBe("Marta · Creative director");
    expect(captionOf(s, updatePerson(marta, "role", null))).toBe("Marta · role cleared");
    expect(captionOf(s, updatePerson(marta, "email", "marta@studio.it"))).toBe("Marta · marta@studio.it");
    expect(captionOf(s, updatePerson(marta, "dayRateCents", 45_000))).toBe("Marta · day rate €450");
    const set = after(s, updatePerson(marta, "email", "marta@studio.it"), updatePerson(marta, "dayRateCents", 45_000));
    expect(captionOf(set, updatePerson(marta, "email", null))).toBe("Marta · email cleared");
    expect(captionOf(set, updatePerson(marta, "dayRateCents", null))).toBe("Marta · day rate cleared");
  });

  it("renames a person to another casing of their own name", () => {
    expect(captionOf(demo(), updatePerson(marta, "name", "MARTA"))).toBe("Marta renamed to MARTA");
  });

  it("is a no-op, by reference, for the same value", () => {
    const s = demo();
    const r = apply(s, updatePerson(marta, "capacityDaysPerWeek", 2));
    expectNoop(r.result, r.before);
    expect(run(s, [updatePerson(marta, "capacityDaysPerWeek", 2)]).caption).toEqual(noop("Marta already has 2 days a week"));
    expect(captionOf(s, updatePerson(marta, "name", "Marta"))).toBe("Already called Marta");
    expect(captionOf(s, updatePerson(marta, "role", "Art director"))).toBe("Marta is already Art director");
    expect(captionOf(s, updatePerson(marta, "email", null))).toBe("Marta has no email");
    expect(captionOf(s, updatePerson(marta, "dayRateCents", null))).toBe("Marta has no day rate");
    const unknown = withPerson(s, marta, { capacityDaysPerWeek: null, role: null });
    expect(captionOf(unknown, updatePerson(marta, "capacityDaysPerWeek", null))).toBe("Marta's capacity isn't set");
    expect(captionOf(unknown, updatePerson(marta, "role", null))).toBe("Marta has no role set");
    const rated = after(s, updatePerson(marta, "dayRateCents", 45_000), updatePerson(marta, "email", "marta@studio.it"));
    expect(captionOf(rated, updatePerson(marta, "dayRateCents", 45_000))).toBe("Marta's day rate is already €450");
    expect(captionOf(rated, updatePerson(marta, "email", "marta@studio.it"))).toBe("Marta's email is already marta@studio.it");
  });

  it("refuses a capacity outside 0–7 half days in words (plan §4.5)", () => {
    const s = demo();
    const r = expectRejection(apply(s, updatePerson(marta, "capacityDaysPerWeek", 10)).result, "invalid_payload");
    expect(r.message).toBe("Capacity is days per week (0–7).");
    expect(captionOf(s, updatePerson(marta, "capacityDaysPerWeek", 10))).toBe("Couldn't apply that: Capacity is days per week (0–7).");
    expectRejection(apply(s, updatePerson(marta, "capacityDaysPerWeek", 2.7)).result, "invalid_payload");
    expectRejection(apply(s, updatePerson(marta, "capacityDaysPerWeek", -1)).result, "invalid_payload");
  });

  it("refuses a missing person, another active person's name, and invalid values", () => {
    const s = demo();
    expectRejection(apply(s, updatePerson(mint("person"), "role", null)).result, "not_found");
    const taken = expectRejection(apply(s, updatePerson(marta, "name", "sara")).result, "invalid_state");
    expect(taken.message).toBe("There's already someone called Sara in the team.");
    // Only active names must differ: an archived person may share one
    const archived = withPerson(s, luca, { archived: true });
    expectApplied(apply(archived, updatePerson(luca, "name", "Sara")).result);
    expectApplied(apply(archived, updatePerson(marta, "name", "Luca")).result);
    expectRejection(apply(s, updatePerson(marta, "dayRateCents", -5)).result, "invalid_payload");
    expectRejection(apply(s, updatePerson(marta, "email", "nope")).result, "invalid_payload");
    expectRejection(apply(s, updatePerson(marta, "colour", "red")).result, "invalid_payload");
    expectRejection(apply(fullDemo(), updatePerson(marta, "email", `${"m".repeat(200)}@studio.it`)).result, "limit");
  }, 20_000);
});

/* ------------------------------------------------------------------
   archivePerson, restorePerson, deletePerson
   ------------------------------------------------------------------ */

describe("archivePerson", () => {
  it("takes a person off the team, counting their open tasks across projects (Q7)", () => {
    const s = demo();
    const op = { op: "archivePerson", personId: luca };
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).people[luca].archived).toBe(true);
    const result = run(s, [op]);
    expect(result.caption?.text).toBe("Luca removed · 1 task unassigned");
    // No op touches two documents: the projects are the same objects
    expect(result.state.projects).toBe(s.projects);
    expect(captionOf(s, { op: "archivePerson", personId: marta })).toBe("Marta removed · 2 tasks unassigned");
    // Sara's only task is done
    expect(captionOf(s, { op: "archivePerson", personId: sara })).toBe("Sara removed");
  });

  it("is a no-op for someone who has already left", () => {
    const s = withPerson(demo(), luca, { archived: true });
    const r = apply(s, { op: "archivePerson", personId: luca });
    expectNoop(r.result, r.before);
    expect(captionOf(s, { op: "archivePerson", personId: luca })).toBe("Luca has already left the team");
  });

  it("refuses a missing person", () => {
    const gone = expectRejection(apply(demo(), { op: "archivePerson", personId: mint("person") }).result, "not_found");
    expect(gone.message).toBe("That person isn't in the workspace anymore.");
  });
});

describe("restorePerson", () => {
  it("brings an archived person back", () => {
    const s = withPerson(demo(), luca, { archived: true });
    const op = { op: "restorePerson", personId: luca };
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).people[luca].archived).toBe(false);
    expect(captionOf(s, op)).toBe("Luca is back in the team");
  });

  it("is a no-op for someone on the team", () => {
    const s = demo();
    const r = apply(s, { op: "restorePerson", personId: luca });
    expectNoop(r.result, r.before);
    expect(captionOf(s, { op: "restorePerson", personId: luca })).toBe("Luca is already in the team");
  });

  it("refuses a missing person and a name someone active took meanwhile", () => {
    const s = withPerson(demo(), luca, { archived: true });
    expectRejection(apply(s, { op: "restorePerson", personId: mint("person") }).result, "not_found");
    const taken = after(s, person({ name: "luca" }));
    const r = expectRejection(apply(taken, { op: "restorePerson", personId: luca }).result, "invalid_state");
    expect(r.message).toBe("There's already someone called luca in the team.");
  });
});

describe("deletePerson", () => {
  it("deletes someone who owns nothing, for good", () => {
    const add = person();
    const s = after(demo(), add);
    const op = { op: "deletePerson", personId: add.personId };
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(Object.hasOwn(wsOf(r).people, add.personId)).toBe(false);
    expect(captionOf(s, op)).toBe("Giulia deleted");
    expect(REGISTRY.get("deletePerson")!.idempotent).toBe(false);
    expectRejection(apply(after(s, op), op).result, "not_found");
  });

  it("refuses anyone who still owns a task or a step, in any project (Q8)", () => {
    const s = demo();
    const owns = expectRejection(apply(s, { op: "deletePerson", personId: luca }, { ctx: { ownership: () => 1 } }).result, "owns_tasks");
    expect(owns.message).toBe("Luca still owns 1 task or step: reassign it first.");
    // The runner counts ownership across every project
    expect(captionOf(s, { op: "deletePerson", personId: marta })).toBe("Couldn't apply that: Marta still owns 2 tasks or steps: reassign them first.");
    const giulia = person();
    const withStep = after(s, giulia);
    const ui = taskByTitle(projectOf(withStep), "UI Design");
    const stepOwned = deepFreeze(
      withDoc(withStep, {
        ...projectOf(withStep),
        tasks: { ...projectOf(withStep).tasks, [ui.id]: { ...ui, steps: [{ id: mint("step"), title: "Icons", done: false, ownerId: giulia.personId as PersonId, estimateDays: null }] } },
      }),
    );
    expect(captionOf(stepOwned, { op: "deletePerson", personId: giulia.personId })).toBe(
      "Couldn't apply that: Giulia still owns 1 task or step: reassign it first.",
    );
  });

  it("refuses a missing person", () => {
    expectRejection(apply(demo(), { op: "deletePerson", personId: mint("person") }).result, "not_found");
  });
});

/* ------------------------------------------------------------------
   linkPersonToMe
   ------------------------------------------------------------------ */

describe("linkPersonToMe", () => {
  const link = (personId: PersonId, userId = "user_1") => ({ op: "linkPersonToMe", personId, userId });

  it("links a person to the account, unlinking whoever had it", () => {
    const s = after(demo(), link(sara));
    const r = apply(s, link(marta));
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).people[marta].userId).toBe("user_1");
    expect(wsOf(r).people[sara].userId).toBeNull();
    expect(checkWorkspace(wsOf(r))).toEqual([]);
    expect(captionOf(s, link(marta))).toBe("This is you: Marta");
  });

  it("is a no-op when the person is already linked", () => {
    const s = after(demo(), link(marta));
    const r = apply(s, link(marta));
    expectNoop(r.result, r.before);
    expect(captionOf(s, link(marta))).toBe("Marta is already you");
  });

  it("refuses a missing or archived person and an empty account", () => {
    const s = demo();
    expectRejection(apply(s, link(mint("person"))).result, "not_found");
    const left = expectRejection(apply(withPerson(s, luca, { archived: true }), link(luca)).result, "archived");
    expect(left.message).toBe("Luca has left the team.");
    expectRejection(apply(s, link(marta, "")).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   addTimeOff and removeTimeOff
   ------------------------------------------------------------------ */

describe("addTimeOff", () => {
  it("adds days off for a person", () => {
    const s = demo();
    const op = timeOff(marta, { label: "Holiday" });
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    const id = op.timeOff.timeOffId;
    expect(wsOf(r).people[marta].timeOff[id]).toEqual({ id, from: "2026-11-02", to: "2026-11-06", label: "Holiday" });
    expect(captionOf(s, op)).toBe("Marta is off 2–6 Nov");
    expect(captionOf(s, timeOff(sara, { from: "2026-10-30", to: "2026-11-02" }))).toBe("Sara is off 30 Oct–2 Nov");
  });

  it("refuses a missing or archived person, a taken id, a backwards range and a 101st entry", () => {
    const s = demo();
    expectRejection(apply(s, timeOff(mint("person"))).result, "not_found");
    expectRejection(apply(withPerson(s, luca, { archived: true }), timeOff(luca)).result, "archived");
    const op = timeOff(marta);
    expect(REGISTRY.get("addTimeOff")!.idempotent).toBe(false);
    expectRejection(apply(after(s, op), op).result, "duplicate_id");
    expectRejection(apply(s, timeOff(marta, { from: "2026-11-06", to: "2026-11-02" })).result, "invalid_payload");
    const busy = withPerson(s, marta, {
      timeOff: byId(Array.from({ length: TIME_OFF_MAX }, () => ({ id: mint("timeOff"), from: IsoDate.parse("2027-01-04"), to: IsoDate.parse("2027-01-04"), label: null }))),
    });
    const limit = expectRejection(apply(busy, timeOff(marta)).result, "limit");
    expect(limit.message).toBe("A person holds at most 100 time-off entries.");
    expectRejection(apply(fullDemo(), timeOff(marta, { label: "x".repeat(60) })).result, "limit");
  }, 20_000);
});

describe("removeTimeOff", () => {
  it("removes one entry, and refuses one that isn't there", () => {
    const add = timeOff(marta);
    const s = after(demo(), add);
    const op = { op: "removeTimeOff", personId: marta, timeOffId: add.timeOff.timeOffId };
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).people[marta].timeOff).toEqual({});
    expect(captionOf(s, op)).toBe("Time off removed");
    expectRejection(apply(after(s, op), op).result, "not_found");
    expectRejection(apply(s, { ...op, personId: mint("person") }).result, "not_found");
  });
});

/* ------------------------------------------------------------------
   Templates
   ------------------------------------------------------------------ */

describe("saveTemplate", () => {
  it("saves a template, normalising milestones and repeated dependencies", () => {
    const s = demo();
    const op = template({}, [
      templateTask({ title: "Research", estimateDays: 3 }),
      templateTask({ title: "Design", dependsOn: [0, 0], steps: ["Wireframes"], roleHint: "Designer" }),
      templateTask({ title: "Launch", kind: "milestone", estimateDays: 2, dependsOn: [1], steps: ["Party"] }),
    ]);
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    const saved = wsOf(r).templates[op.template.templateId as TemplateId];
    expect(saved).toMatchObject({ name: "Website, four phases", kind: "website", createdAt: FIXTURE_NOW });
    expect(saved.tasks[1].dependsOn).toEqual([0]);
    expect(saved.tasks[2]).toMatchObject({ kind: "milestone", estimateDays: 0, steps: [], dependsOn: [1] });
    expect(checkWorkspace(wsOf(r))).toEqual([]);
    expect(captionOf(s, op)).toBe("Saved as template · Website, four phases");
  });

  it("refuses a taken id, later dependencies, a zero estimate, a 51st template and 1 MB", () => {
    const s = demo();
    const op = template();
    expect(REGISTRY.get("saveTemplate")!.idempotent).toBe(false);
    expectRejection(apply(after(s, op), op).result, "duplicate_id");
    const later = expectRejection(apply(s, template({}, [templateTask({ dependsOn: [0] })])).result, "invalid_payload");
    expect(later.message).toBe("A template task can only follow the tasks before it.");
    expectRejection(apply(s, template({}, [templateTask(), templateTask({ dependsOn: [2] })])).result, "invalid_payload");
    expectRejection(apply(s, template({}, [templateTask({ estimateDays: 0 })])).result, "invalid_payload");
    expectRejection(apply(s, template({}, [])).result, "invalid_payload");
    const many = withWs(s, (ws) => {
      const list = Array.from({ length: TEMPLATES_MAX }, (_, i) => ({
        id: mint("template"),
        name: `Template ${i + 1}`,
        kind: "other" as const,
        tasks: [templateTask()],
        createdAt: FIXTURE_NOW,
      }));
      return { ...ws, templates: byId(list) };
    });
    expectRejection(apply(many, template()).result, "limit");
    expectRejection(apply(fullDemo(), template()).result, "limit");
  }, 20_000);
});

describe("updateTemplate", () => {
  const saved = template();
  const id = saved.template.templateId;
  const edit = (field: string, value: unknown, templateId: string = id) => ({ op: "updateTemplate", templateId, field, value });

  it("renames a template and changes its kind", () => {
    const s = after(demo(), saved);
    const r = apply(s, edit("name", "Website, five phases"));
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).templates[id as TemplateId].name).toBe("Website, five phases");
    expect(captionOf(s, edit("name", "Website, five phases"))).toBe("Template renamed to Website, five phases");
    expect(captionOf(s, edit("kind", "brand-identity"))).toBe("Website, four phases · Brand identity");
  });

  it("is a no-op for the same value", () => {
    const s = after(demo(), saved);
    const r = apply(s, edit("kind", "website"));
    expectNoop(r.result, r.before);
    expect(captionOf(s, edit("kind", "website"))).toBe("Website, four phases is already set to Website");
    expect(captionOf(s, edit("name", "Website, four phases"))).toBe("Template already called Website, four phases");
  });

  it("refuses a missing template and invalid values", () => {
    const s = after(demo(), saved);
    expectRejection(apply(s, edit("name", "Renamed", mint("template"))).result, "not_found");
    expectRejection(apply(s, edit("kind", "poster")).result, "invalid_payload");
    expectRejection(apply(s, edit("name", "x".repeat(61))).result, "invalid_payload");
  });
});

describe("deleteTemplate", () => {
  it("deletes a template, and refuses one that isn't there", () => {
    const saved = template();
    const s = after(demo(), saved);
    const op = { op: "deleteTemplate", templateId: saved.template.templateId };
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).templates).toEqual({});
    expect(captionOf(s, op)).toBe("Template deleted");
    expect(REGISTRY.get("deleteTemplate")!.idempotent).toBe(false);
    expectRejection(apply(after(s, op), op).result, "not_found");
  });
});

/* ------------------------------------------------------------------
   createProject
   ------------------------------------------------------------------ */

describe("createProject", () => {
  it("indexes the project on the workspace and spawns its document", () => {
    const s = demo();
    const seeds = demoSeeds();
    const op = create({ startAs: "timeline", startDate: "2026-09-28", memberIds: [sara, sara], tags: ["web", "web"] }, seeds);
    const r = apply(s, op);
    const applied = expectApplied(r.result);
    expectInverse(r.before, applied);
    const id = op.projectId as ProjectId;
    expect(wsOf(r).projects[id]).toEqual({ id, createdAt: FIXTURE_NOW, archivedAt: null, deletedAt: null });

    const p = applied.spawned!;
    expect(Object.isFrozen(p)).toBe(true);
    expect(ProjectDocSchema.safeParse(p).success).toBe(true);
    expect(checkProject(p)).toEqual([]);
    expect(p).toMatchObject({
      id,
      workspaceId: s.workspace.id,
      title: "Ceramica Bassi",
      status: "active",
      views: ["timeline"],
      blocks: ["header", "metrics", "collection"],
      memberIds: [sara, marta, luca],
      tags: ["web"],
      proposal: null,
      createdAt: FIXTURE_NOW,
    });
    const [research, visual, ui, dev] = seeds.map((seed) => p.tasks[seed.taskId]);
    expect(research).toMatchObject({ status: "done", progress: 100, completedAt: FIXTURE_NOW, order: nKeys(4)[0], ownerId: sara });
    expect(ui).toMatchObject({ status: "active", progress: 30, completedAt: null, dependsOn: [visual.id], order: nKeys(4)[2] });
    expect(dev.dependsOn).toEqual([ui.id]);
    // Born as a timeline on an unconfirmed start: its dates are samples (caption policy rule 6)
    expect(captionOf(s, op)).toBe("Timeline created · 4 tasks · sample dates, sequenced from estimates");
  });

  it("says the dates are samples only on a timeline birth with an unconfirmed start and tasks", () => {
    const s = demo();
    expect(captionOf(s, create({ startAs: "timeline", startDate: "2026-09-28", startConfirmed: true }, demoSeeds()))).toBe("Timeline created · 4 tasks");
    expect(captionOf(s, create({ startAs: "board", startDate: "2026-09-28" }, demoSeeds()))).toBe("Board created · 4 tasks");
    expect(captionOf(s, create({ startAs: "timeline", startDate: null }, demoSeeds()))).toBe("Timeline created · 4 tasks");
    expect(captionOf(s, create({ startAs: "timeline", startDate: "2026-09-28" }))).toBe("Timeline created · no tasks yet");
  });

  it("starts the command's project ops on the new project, after people added in the same command", () => {
    const s = empty();
    const giulia = person();
    const task = taskSeed({ taskId: mint("task"), title: "Discovery", ownerId: giulia.personId as PersonId });
    const op = create({ startAs: "board", leadId: giulia.personId }, [task]);
    const addTask = { op: "addTask", taskId: mint("task"), title: "Copywriting", kind: "task", place: "end", dependsOn: [task.taskId], estimateDays: null, priority: "medium", ownerId: giulia.personId };
    const result = run(s, [giulia, op, addTask]);
    expect(result.spawned).toHaveLength(1);
    expect(result.projectId).toBe(op.projectId);
    const p = result.state.projects[op.projectId as ProjectId];
    expect(Object.values(p.tasks).map((t) => t.title).sort()).toEqual(["Copywriting", "Discovery"]);
    expect(p.memberIds).toEqual([giulia.personId]);
    // At most four parts (caption policy rule 7): the new task is on screen, its part is cut
    expect(result.caption?.text).toBe("Giulia added to the team · capacity not set · Board created · 1 task");
    // The workspace commit and the project commit share one group
    expect(result.commits.map((c) => c.docId)).toEqual([s.workspace.id, op.projectId]);
  });

  it("says so when a project starts empty, and keeps the project planning until a task is under way", () => {
    const r = apply(demo(), create());
    expect(expectApplied(r.result).spawned).toMatchObject({ status: "planning", tasks: {}, views: ["cards"] });
    expect(captionOf(demo(), create())).toBe("Tracker created · no tasks yet");
  });

  it("normalises milestones and the calendar override", () => {
    const closureId = mint("closure");
    const ms = taskSeed({ taskId: mint("task"), title: "Launch", kind: "milestone", estimateDays: 3, steps: [{ stepId: mint("step"), title: "Party", estimateDays: null }] });
    const op = create(
      { calendarOverride: { workingDays: [5, 1, 2, 3, 4, 4], closures: { [closureId]: { id: closureId, from: "2026-12-24", to: "2026-12-26", label: "Christmas" } } } },
      [ms],
    );
    const p = expectApplied(apply(demo(), op).result).spawned!;
    expect(p.tasks[ms.taskId]).toMatchObject({ kind: "milestone", estimateDays: 0, allocation: 1, steps: [] });
    expect(p.calendarOverride?.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(checkProject(p)).toEqual([]);
  });

  it("is never a no-op: the same project again is a taken id", () => {
    const s = demo();
    const op = create();
    expect(REGISTRY.get("createProject")!.idempotent).toBe(false);
    expectRejection(apply(after(s, op), op).result, "duplicate_id");
  });

  it("refuses taken and repeated ids, and a 501st project", () => {
    const s = demo();
    const seeds = demoSeeds();
    expectRejection(apply(s, { ...create(), projectId: s.projectId }).result, "duplicate_id");
    expectRejection(apply(s, create({}, [seeds[0], { ...seeds[1], taskId: seeds[0].taskId, dependsOn: [] }])).result, "duplicate_id");
    const step = { stepId: mint("step"), title: "Draft", estimateDays: null };
    expectRejection(apply(s, create({}, [{ ...seeds[0], steps: [step] }, { ...seeds[1], steps: [step] }])).result, "duplicate_id");
    const link = { id: mint("link"), label: "Figma", url: "https://www.figma.com/file/form" };
    expectRejection(apply(s, create({ links: [link, link] })).result, "duplicate_id");
    const crowded = withWs(s, (ws) => {
      const ids = Array.from({ length: PROJECTS_MAX }, () => mint("project"));
      return { ...ws, projects: byId(ids.map((id) => indexEntry(id))) };
    });
    const limit = expectRejection(apply(crowded, create()).result, "limit");
    expect(limit.message).toBe("A workspace holds at most 500 projects.");
  });

  it("refuses a project past 1 MB", () => {
    const seeds = Array.from({ length: TEMPLATE_TASKS_MAX }, (_, i) =>
      taskSeed({
        taskId: mint("task"),
        title: `Task ${i + 1}`,
        steps: Array.from({ length: STEPS_MAX }, () => ({ stepId: mint("step"), title: "x".repeat(STEP_TITLE), estimateDays: null })),
      }),
    );
    const r = expectRejection(apply(demo(), create({}, seeds)).result, "limit");
    expect(r.message).toBe("The new project would pass the 1 MB limit for a project.");
  });

  it("refuses dependencies on itself or on a later or unknown task", () => {
    const s = demo();
    const [a, b] = demoSeeds();
    expectRejection(apply(s, create({}, [{ ...a, dependsOn: [a.taskId] }])).result, "self_dependency");
    const later = expectRejection(apply(s, create({}, [{ ...a, dependsOn: [b.taskId] }, { ...b, dependsOn: [] }])).result, "not_found");
    expect(later.message).toBe("Research waits on a task that doesn't come before it.");
    expectRejection(apply(s, create({}, [{ ...a, dependsOn: [mint("task")] }])).result, "not_found");
  });

  it("refuses people who aren't in the workspace or have left the team", () => {
    const s = demo();
    const [a] = demoSeeds();
    expectRejection(apply(s, create({}, [{ ...a, ownerId: mint("person") }])).result, "invalid_reference");
    expectRejection(apply(s, create({ leadId: mint("person") })).result, "invalid_reference");
    const left = withPerson(s, luca, { archived: true });
    const r = expectRejection(apply(left, create({ memberIds: [luca] })).result, "archived");
    expect(r.message).toBe("Luca has left the team.");
  });

  it("refuses incoherent seeds and drafts", () => {
    const s = demo();
    const [a] = demoSeeds();
    const todo = expectRejection(apply(s, create({}, [{ ...a, status: "todo", progress: 30 }])).result, "invalid_state");
    expect(todo.message).toBe("Research: To do at 30%: To do means 0%.");
    // In review at 100% needs the review step
    expectRejection(apply(s, create({}, [{ ...a, status: "review", progress: 100 }])).result, "invalid_state");
    expectApplied(apply(s, create({ requireReview: true }, [{ ...a, status: "review", progress: 100 }])).result);
    const ms = expectRejection(apply(s, create({}, [{ ...a, kind: "milestone", estimateDays: 0, status: "active", progress: 30 }])).result, "invalid_state");
    expect(ms.message).toBe("Research is a milestone: it's either to do or done.");
    expectRejection(apply(s, create({}, [{ ...a, estimateDays: 0 }])).result, "invalid_payload");
    const dates = expectRejection(apply(s, create({ startDate: "2026-12-01", deadline: "2026-11-01" })).result, "invalid_payload");
    expect(dates.message).toBe("The deadline comes before the start.");
    const id = mint("closure");
    const back = { workingDays: null, closures: { [id]: { id, from: "2026-12-26", to: "2026-12-24", label: "Christmas" } } };
    expectRejection(apply(s, create({ calendarOverride: back })).result, "invalid_payload");
    const misfiled = { workingDays: null, closures: { [mint("closure")]: { id, from: "2026-12-24", to: "2026-12-26", label: "Christmas" } } };
    expectRejection(apply(s, create({ calendarOverride: misfiled })).result, "invalid_payload");
    expectRejection(apply(s, create({ startAs: "team" })).result, "invalid_payload");
    expectRejection(apply(s, create({ title: "x".repeat(81) })).result, "invalid_payload");
  });
});

/* ------------------------------------------------------------------
   duplicateProject
   ------------------------------------------------------------------ */

describe("duplicateProject", () => {
  /** The demo with everything a copy must follow: a pin, brief edits and lines, mood, links, a proposal, a sent brief */
  function richDemo(): TestState {
    const s = demoState();
    const p = projectOf(s);
    const ui = taskByTitle(p, "UI Design");
    const closureId = mint("closure");
    const moodId = mint("moodItem");
    const rich: ProjectDoc = {
      ...p,
      calendarOverride: {
        workingDays: [1, 2, 3, 4],
        closures: { [closureId]: { id: closureId, from: IsoDate.parse("2026-12-24"), to: IsoDate.parse("2026-12-26"), label: "Christmas" } },
      },
      links: [{ id: mint("link"), label: "Figma", url: "https://www.figma.com/file/form" }],
      tasks: {
        ...p.tasks,
        [ui.id]: {
          ...ui,
          steps: [{ id: mint("step"), title: "Wireframes", done: true, ownerId: marta, estimateDays: 1 }],
          links: [{ id: mint("link"), label: "Screens", url: "https://www.figma.com/file/screens" }],
        },
      },
      viewConfig: { ...p.viewConfig, focusPin: ui.id },
      moodboard: {
        items: { [moodId]: { id: moodId, kind: "color", x: 0, y: 0, w: 0.2, h: 0.2, r: 0, z: "a0", assetId: null, hex: "#0c0c0c", text: null } },
      },
      brief: {
        edits: {
          [`client:risks:${ui.id}`]: { text: "", basis: "UI Design is urgent." },
          "client:head:status": { text: "All good.", basis: "On track." },
        },
        lines: [{ id: mint("briefLine"), audience: "client", section: "next", text: "Homepage preview on Friday" }],
        sent: [{ snapshotId: mint("snapshot"), audience: "client", sentAt: FIXTURE_NOW }],
        sharing: { showBudgetToClient: true },
      },
      proposal: { id: mint("proposal"), createdAt: FIXTURE_NOW, source: "agent", kind: "estimates", items: [{ taskId: ui.id, estimateDays: 5 }] },
    };
    expect(checkProject(rich)).toEqual([]);
    return deepFreeze(withDoc(s, rich));
  }

  const duplicate = (sourceId: string, o: Record<string, unknown> = {}) => ({
    op: "duplicateProject",
    sourceId,
    projectId: mint("project"),
    title: "New website, copy",
    ...o,
  });

  it("indexes the copy and spawns it with every id derived from the new project's id", () => {
    const s = richDemo();
    const source = projectOf(s);
    const op = duplicate(source.id);
    const r = apply(s, op);
    const applied = expectApplied(r.result);
    expectInverse(r.before, applied);
    const id = op.projectId as ProjectId;
    expect(wsOf(r).projects[id]).toEqual({ id, createdAt: FIXTURE_NOW, archivedAt: null, deletedAt: null });

    const copy = applied.spawned!;
    expect(ProjectDocSchema.safeParse(copy).success).toBe(true);
    expect(checkProject(copy)).toEqual([]);
    const derived = <K extends IdKind>(kind: K, old: string) => deriveId(kind, id, old);
    const ui = taskByTitle(source, "UI Design");
    const visual = taskByTitle(source, "Visual Direction");
    const copiedUi = copy.tasks[derived("task", ui.id)];
    expect(copiedUi).toMatchObject({ title: "UI Design", status: "active", progress: 30, order: ui.order, createdAt: FIXTURE_NOW });
    expect(copiedUi.dependsOn).toEqual([derived("task", visual.id)]);
    expect(copiedUi.steps[0]).toEqual({ ...ui.steps[0], id: derived("step", ui.steps[0].id) });
    expect(copiedUi.links[0].id).toBe(derived("link", ui.links[0].id));
    expect(copy.links[0].id).toBe(derived("link", source.links[0].id));
    expect(copy.viewConfig.focusPin).toBe(copiedUi.id);
    expect(Object.keys(copy.brief.edits).sort()).toEqual(["client:head:status", `client:risks:${copiedUi.id}`]);
    expect(copy.brief.lines[0].id).toBe(derived("briefLine", source.brief.lines[0].id));
    expect(copy.brief.sent).toEqual([]);
    expect(copy.brief.sharing).toEqual({ showBudgetToClient: true });
    expect(copy.proposal).toBeNull();
    expect(Object.keys(copy.moodboard.items)).toEqual([derived("moodItem", Object.keys(source.moodboard.items)[0])]);
    expect(Object.keys(copy.calendarOverride!.closures!)).toEqual([derived("closure", Object.keys(source.calendarOverride!.closures!)[0])]);
    expect(copy).toMatchObject({ id, title: "New website, copy", status: source.status, memberIds: source.memberIds, createdAt: FIXTURE_NOW });
    // Done work keeps when it was completed
    const research = taskByTitle(source, "Research");
    expect(copy.tasks[derived("task", research.id)].completedAt).toBe(research.completedAt);

    // A replay derives the same copy
    expect(expectApplied(apply(s, op).result).spawned).toEqual(copy);
    const result = run(s, [op]);
    expect(result.caption?.text).toBe("Duplicated as New website, copy");
    expect(result.projectId).toBe(id);
  });

  it("copies an archived project too", () => {
    const s = withWs(demo(), (ws) => ({
      ...ws,
      projects: Object.fromEntries(Object.entries(ws.projects).map(([k, e]) => [k, { ...e, archivedAt: FIXTURE_NOW }])),
    }));
    expectApplied(apply(s, duplicate(s.projectId!)).result);
  });

  it("is never a no-op: the same copy again is a taken id", () => {
    const s = demo();
    const op = duplicate(s.projectId!);
    expect(REGISTRY.get("duplicateProject")!.idempotent).toBe(false);
    expectRejection(apply(after(s, op), op).result, "duplicate_id");
    expectRejection(apply(s, duplicate(s.projectId!, { projectId: s.projectId })).result, "duplicate_id");
  });

  it("refuses a missing, deleted or unreadable source", () => {
    const s = demo();
    expectRejection(apply(s, duplicate(mint("project"))).result, "not_found");
    const deleted = after(s, { op: "deleteProject", projectId: s.projectId });
    const gone = expectRejection(apply(deleted, duplicate(s.projectId!)).result, "not_found");
    expect(gone.message).toBe("That project isn't in the workspace anymore.");
    expectRejection(apply(s, duplicate(s.projectId!), { ctx: { readProject: () => null } }).result, "not_found");
    expectRejection(apply(s, duplicate(s.projectId!, { title: "" })).result, "invalid_payload");
  });

  it("refuses a 501st project and a copy past 1 MB", () => {
    const s = demo();
    const crowded = withWs(s, (ws) => {
      const ids = Array.from({ length: PROJECTS_MAX - 1 }, () => mint("project"));
      return { ...ws, projects: { ...ws.projects, ...byId(ids.map((id) => indexEntry(id))) } };
    });
    expectRejection(apply(crowded, duplicate(s.projectId!)).result, "limit");
    // Short readable ids grow to 16 characters in the copy, so 500 tasks just under 1 MB pass it
    const orders = nKeys(500);
    const build = (chars: number) =>
      makeProject({
        id: s.projectId!,
        workspaceId: s.workspace.id,
        title: "Big",
        tasks: byId(
          orders.map((order, i) =>
            makeTask({ id: `tsk_${String(i).padStart(8, "0")}` as TaskId, title: `Task ${i}`, order, description: "x".repeat(chars) }),
          ),
        ),
      });
    const room = DOC_BYTES_MAX - 3000 - docBytes(build(0));
    const big = deepFreeze(withDoc(s, build(Math.floor(room / 500))));
    expect(checkProject(projectOf(big))).toEqual([]);
    const r = expectRejection(apply(big, duplicate(s.projectId!)).result, "limit");
    expect(r.message).toBe("The copy would pass the 1 MB limit for a project.");
  });
});

/* ------------------------------------------------------------------
   archiveProject, restoreProject, deleteProject
   ------------------------------------------------------------------ */

describe("archiveProject", () => {
  it("archives a project in the index, leaving its document alone (Q9)", () => {
    const s = demo();
    const op = { op: "archiveProject", projectId: s.projectId };
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).projects[s.projectId!].archivedAt).toBe(FIXTURE_NOW);
    const result = run(s, [op]);
    expect(result.caption?.text).toBe("New website archived");
    expect(result.state.projects).toBe(s.projects);
    // An archived project can still be the open one
    expect(result.projectId).toBe(s.projectId);
    // Another project is named only when it is the open one
    const two = twoProjects();
    expect(captionOf(two, { op: "archiveProject", projectId: otherProjectId(two) })).toBe("Project archived");
  });

  it("is a no-op for an archived project", () => {
    const s = after(demo(), { op: "archiveProject", projectId: demo().projectId });
    const op = { op: "archiveProject", projectId: s.projectId };
    const r = apply(s, op);
    expectNoop(r.result, r.before);
    expect(captionOf(s, op)).toBe("New website is already archived");
    const t = twoProjects();
    const two = after(t, { op: "archiveProject", projectId: otherProjectId(t) });
    expect(captionOf(two, { op: "archiveProject", projectId: otherProjectId(two) })).toBe("That project is already archived");
  });

  it("refuses a missing or deleted project", () => {
    const s = demo();
    expectRejection(apply(s, { op: "archiveProject", projectId: mint("project") }).result, "not_found");
    const deleted = after(s, { op: "deleteProject", projectId: s.projectId });
    expectRejection(apply(deleted, { op: "archiveProject", projectId: s.projectId }).result, "not_found");
  });
});

describe("restoreProject", () => {
  it("brings an archived project back", () => {
    const s = after(demo(), { op: "archiveProject", projectId: demo().projectId });
    const op = { op: "restoreProject", projectId: s.projectId };
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).projects[s.projectId!].archivedAt).toBeNull();
    expect(captionOf(s, op)).toBe("New website restored");
    const t = twoProjects();
    const two = after(t, { op: "archiveProject", projectId: otherProjectId(t) });
    expect(captionOf(two, { op: "restoreProject", projectId: otherProjectId(two) })).toBe("Project restored");
  });

  it("is a no-op for a project that isn't archived", () => {
    const s = demo();
    const op = { op: "restoreProject", projectId: s.projectId };
    const r = apply(s, op);
    expectNoop(r.result, r.before);
    expect(captionOf(s, op)).toBe("New website isn't archived");
  });

  it("refuses a missing or deleted project", () => {
    const s = demo();
    expectRejection(apply(s, { op: "restoreProject", projectId: mint("project") }).result, "not_found");
    const deleted = after(s, { op: "deleteProject", projectId: s.projectId });
    expectRejection(apply(deleted, { op: "restoreProject", projectId: s.projectId }).result, "not_found");
  });
});

describe("deleteProject", () => {
  it("deletes softly: the index entry is marked and the document stays for undo", () => {
    const s = demo();
    const op = { op: "deleteProject", projectId: s.projectId };
    const r = apply(s, op);
    expectInverse(r.before, expectApplied(r.result));
    expect(wsOf(r).projects[s.projectId!].deletedAt).toBe(FIXTURE_NOW);
    const result = run(s, [op]);
    expect(result.state.projects).toBe(s.projects);
    // The demo's reset: nothing is left open
    expect(result.caption?.text).toBe("Workspace reset");
    expect(result.projectId).toBeNull();
  });

  it("names the project, or replaces it silently when the command creates the next one", () => {
    const two = twoProjects();
    const result = run(two, [{ op: "deleteProject", projectId: two.projectId }]);
    expect(result.caption?.text).toBe("Project deleted");
    expect(result.projectId).toBe(otherProjectId(two));
    const s = demo();
    const replaced = run(s, [{ op: "deleteProject", projectId: s.projectId }, create({}, demoSeeds())]);
    expect(replaced.caption?.text).toBe("Tracker created · 4 tasks");
    expect(replaced.projectId).not.toBe(s.projectId);
  });

  it("is a no-op for a deleted project", () => {
    const s = after(demo(), { op: "deleteProject", projectId: demo().projectId });
    const op = { op: "deleteProject", projectId: s.projectId };
    const r = apply(s, op);
    expectNoop(r.result, r.before);
    expect(REGISTRY.get("deleteProject")!.idempotent).toBe(true);
    expect(captionOf(s, op)).toBe("That project is already deleted");
  });

  it("refuses a project that isn't in the index", () => {
    const gone = expectRejection(apply(demo(), { op: "deleteProject", projectId: mint("project") }).result, "not_found");
    expect(gone.message).toBe("That project isn't in the workspace anymore.");
  });
});

/* ------------------------------------------------------------------
   Spawning under generated payloads (plan §10.3)
   ------------------------------------------------------------------ */

/**
 * A focused companion to reducer.property.test.ts, which draws these ops among all 66: their
 * generators with only the workspace ops that change what they read in between, so spawning is
 * exercised densely (validity, inverse patches, determinism, captions, and undo and redo dropping
 * and restoring the spawned projects, plan §5.8).
 */
describe("createProject and duplicateProject under generated payloads", () => {
  const OPS = ["createProject", "duplicateProject", "createProject", "addPerson", "archivePerson", "archiveProject", "deleteProject"] as const;
  type SpawnStepOp = (typeof OPS)[number];
  const genFor = (op: SpawnStepOp) => (op === "createProject" ? createProjectGen : op === "duplicateProject" ? duplicateProjectGen : GENERATORS[op]);
  const stepArb = fc.record({
    op: fc.constantFrom(...OPS),
    picks: fc.array(fc.nat(), { minLength: 6, maxLength: 6 }),
    text: fc.oneof(fc.string({ maxLength: 90, unit: "grapheme" }), fc.constantFrom("", "  x", "x".repeat(81), "Ceramica Bassi")),
    nums: fc.array(fc.double({ min: -10, max: 400, noNaN: true }), { minLength: 4, maxLength: 4 }),
    flags: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
  });

  function expectValid(doc: WorkspaceDoc | ProjectDoc): void {
    if (doc.docType === "workspace") {
      expect(WorkspaceDocSchema.safeParse(doc).success).toBe(true);
      expect(checkWorkspace(doc)).toEqual([]);
    } else {
      expect(ProjectDocSchema.safeParse(doc).success).toBe(true);
      expect(checkProject(doc)).toEqual([]);
    }
  }

  it("spawn valid projects deterministically, and undo and redo with them", () => {
    const applied = new Set<string>();
    const refused = new Set<string>();
    const fixtures = fc.constantFrom<"empty" | "demo" | "generated60">("empty", "demo", "generated60");
    fc.assert(
      fc.property(fixtures, fc.array(stepArb, { maxLength: 8 }), (fixture, steps) => {
        const m = seededMinter(steps.length + 7);
        const initial = startState(fixture, false, null);
        let state: TestState = { workspace: initial.workspace, projects: { ...initial.projects }, projectId: initial.projectId };
        const history: { patches: Patch[]; inverse: Patch[]; spawned: ProjectDoc[] }[] = [];
        for (const step of steps) {
          const raw = genFor(step.op)(step as StepIntent, state as GenState, m);
          if (raw === null) continue;
          deepFreeze(raw);
          const res = run(state, [raw]);
          const result = res.outcomes[0].result;
          if (result.kind === "rejected") {
            expect(result.rejection.code, result.rejection.message).not.toBe("invalid_result");
            expect(result.rejection.message.length).toBeLessThanOrEqual(140);
            refused.add(step.op);
            continue;
          }
          if (result.kind === "noop") continue;
          applied.add(step.op);
          expectValid(result.doc as WorkspaceDoc);
          for (const p of res.spawned) expectValid(p);
          expect(applyPatches(result.doc, result.inverse)).toEqual(state.workspace);
          // A clone of the inputs gives the same documents, spawned ones included
          const again = apply({ ...state, workspace: structuredClone(state.workspace) }, structuredClone(raw));
          const once = expectApplied(again.result);
          expect(once.doc).toEqual(result.doc);
          expect(once.spawned).toEqual((result as typeof once).spawned);
          expect(res.caption?.text.length ?? 0).toBeGreaterThan(0);
          history.push({ patches: result.patches, inverse: result.inverse, spawned: res.spawned });
          state = { workspace: res.state.workspace, projects: { ...res.state.projects }, projectId: res.projectId ?? state.projectId };
        }
        // Undo everything, dropping spawned projects; then redo everything, adding them back
        let ws = state.workspace;
        let projects: Record<string, ProjectDoc> = { ...state.projects };
        for (const h of [...history].reverse()) {
          ws = applyPatches(ws, h.inverse);
          for (const p of h.spawned) delete projects[p.id];
        }
        expect(ws).toEqual(initial.workspace);
        expect(projects).toEqual(initial.projects);
        for (const h of history) {
          ws = applyPatches(ws, h.patches);
          projects = { ...projects, ...Object.fromEntries(h.spawned.map((p) => [p.id, p])) };
        }
        expect(ws).toEqual(state.workspace);
        expect(projects).toEqual(state.projects);
      }),
      { numRuns: 150 },
    );
    expect([...applied]).toEqual(expect.arrayContaining(["createProject", "duplicateProject"]));
    expect([...refused]).toEqual(expect.arrayContaining(["createProject", "duplicateProject"]));
  }, 60_000);
});

