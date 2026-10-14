// Property generator for updateTask: cycles through every field, so status and progress
// interleave (to and from 100, on milestones too), estimates hit 0 and half days, and tags repeat.
import { PRIORITY_ORDER, STATUS_ORDER } from "@/lib/domain/labels";
import { dateFrom, estimateFrom, type OpGen, pick, pickTask, titleFrom } from "./_pick";

const FIELDS = [
  "status",
  "progress",
  "title",
  "status",
  "estimateDays",
  "progress",
  "priority",
  "allocation",
  "dueDate",
  "costCents",
  "emphasis",
  "tags",
  "kind",
  "description",
] as const;

const TAGS = ["design", "client", "dev", "copy", "design"];

const gen: OpGen = (s, state, mint) => {
  const field = pick(FIELDS, s.picks[1]);
  const raw = s.flags[3] && s.picks[2] % 4 === 0;
  let value: unknown;
  switch (field) {
    case "status":
      value = pick(STATUS_ORDER, s.picks[2]);
      break;
    case "progress":
      // Often an edge (0, 95, 100), otherwise anywhere in 0–100
      value = s.picks[2] % 3 === 0 ? pick([0, 95, 100, 100], s.picks[3]) : Math.round(Math.min(100, Math.max(0, Math.abs(s.nums[0]) % 101)));
      break;
    case "title":
      value = titleFrom(s);
      break;
    case "estimateDays":
      value = s.picks[2] % 7 === 0 ? 0 : estimateFrom(s.nums[1], raw);
      break;
    case "priority":
      value = pick(PRIORITY_ORDER, s.picks[2]);
      break;
    case "allocation":
      value = pick([0.25, 0.5, 0.75, 1], s.picks[2]);
      break;
    case "dueDate":
      value = s.flags[1] ? null : dateFrom(s.nums[2], raw);
      break;
    case "costCents":
      value = s.flags[1] ? null : Math.round(Math.abs(s.nums[2]) * 1000);
      break;
    case "emphasis":
      value = s.flags[1];
      break;
    case "tags":
      // One time in three a repeated tag, which the op must deduplicate
      value = s.flags[1] ? [] : s.picks[2] % 3 === 0 ? [pick(TAGS, s.picks[3]), pick(TAGS, s.picks[3])] : TAGS.slice(s.picks[2] % 3, 2 + (s.picks[3] % 4));
      break;
    case "kind":
      value = s.flags[1] ? "milestone" : "task";
      break;
    case "description":
      value = s.flags[1] ? null : s.text;
      break;
  }
  return { op: "updateTask", taskId: pickTask(s, state, mint, 0), field, value };
};

export default gen;
