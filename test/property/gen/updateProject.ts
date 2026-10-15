// Property generator for updateProject: cycles through every field; a quarter of the time the
// value the project already has (a no-op). Starts and deadlines cross each other, the review step
// toggles (runs that start with it on make In review at 100% reachable), leads may be missing,
// archived or not yet members, the calendar override comes unsorted, repeated, misfiled or
// backwards, and titles, goals and currencies are sometimes invalid.
import { PROJECT_KIND_ORDER, PROJECT_STATUS_ORDER } from "@/lib/domain/labels";
import { activeProject, dateFrom, type OpGen, pick, pickPerson, titleFrom } from "./_pick";

const FIELDS = [
  "title",
  "client",
  "kind",
  "goal",
  "status",
  "startDate",
  "startConfirmed",
  "deadline",
  "deadlineKind",
  "currency",
  "budgetCents",
  "leadId",
  "requireReview",
  "autoChain",
  "calendarOverride",
  "tags",
] as const;

const TAGS = ["web", "client", "launch", "web"];
const DAYS = [[1, 2, 3, 4, 5], [5, 4, 3, 2, 1], [1, 3, 5, 3], [6, 7], [1, 2, 3, 4]];

const gen: OpGen = (s, state, mint) => {
  const field = pick(FIELDS, s.picks[0]);
  const project = activeProject(state);
  if (project && s.picks[1] % 4 === 0) return { op: "updateProject", field, value: project[field] };
  const raw = s.flags[3] && s.picks[2] % 5 === 0;
  let value: unknown;
  switch (field) {
    case "title":
      value = titleFrom(s, 80);
      break;
    case "client":
      value = s.flags[1] ? null : { name: s.flags[2] ? titleFrom(s, 80) : null, contactName: null, contactEmail: s.flags[2] ? null : "pm@studio.com" };
      break;
    case "kind":
      value = pick(PROJECT_KIND_ORDER, s.picks[2]);
      break;
    case "goal":
      value = s.flags[1] ? null : s.text;
      break;
    case "status":
      value = pick(PROJECT_STATUS_ORDER, s.picks[2]);
      break;
    case "startDate":
      value = s.flags[1] ? null : dateFrom(s.nums[0], raw);
      break;
    case "deadline":
      value = s.flags[1] ? null : dateFrom(s.nums[1], raw);
      break;
    case "startConfirmed":
    case "requireReview":
    case "autoChain":
      value = s.flags[1];
      break;
    case "deadlineKind":
      value = s.flags[1] ? "hard" : "soft";
      break;
    case "currency":
      value = pick(["EUR", "USD", "GBP", "eur"], s.picks[2]);
      break;
    case "budgetCents":
      value = s.flags[1] ? null : Math.round(Math.abs(s.nums[2]) * 10_000);
      break;
    case "leadId":
      value = s.flags[1] ? null : pickPerson(s, state, mint, 3);
      break;
    case "calendarOverride": {
      if (s.flags[1]) {
        value = null;
        break;
      }
      const id = mint("closure");
      // One time in eight filed under another id; one in six ending before it starts
      const filed = s.picks[3] % 8 === 0 ? mint("closure") : id;
      const [from, to] = [dateFrom(s.nums[2], false), dateFrom(s.nums[3], false)];
      const range = s.picks[4] % 6 === 0 ? { from: to > from ? to : from, to: to > from ? from : to } : { from: to < from ? to : from, to: to < from ? from : to };
      value = {
        workingDays: s.picks[2] % 3 === 0 ? null : pick(DAYS, s.picks[3]),
        closures: s.picks[4] % 3 === 1 ? null : { [id]: { id: filed, ...range, label: "Studio closed" } },
      };
      break;
    }
    case "tags":
      value = s.flags[1] ? [] : TAGS.slice(s.picks[2] % 2, 2 + (s.picks[3] % 3));
      break;
  }
  return { op: "updateProject", field, value };
};

export default gen;
