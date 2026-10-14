import type {
  BriefSection,
  Priority,
  ProjectKind,
  ProjectStatus,
  SortKey,
  Status,
  ViewKind,
} from "@/lib/domain/schema/primitives";

/**
 * English labels and display orders of the domain enums (moved from v0 `lib/schema.ts` and
 * `lib/brief.ts`, same wording). Components, captions and the parser read these.
 */

export const STATUS_LABEL: Readonly<Record<Status, string>> = {
  todo: "To do",
  active: "In progress",
  review: "In review",
  done: "Done",
};
/** Board lanes and the status menu, left to right */
export const STATUS_ORDER: readonly Status[] = ["todo", "active", "review", "done"];

export const PRIORITY_LABEL: Readonly<Record<Priority, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};
/** The priority control, lowest first */
export const PRIORITY_ORDER: readonly Priority[] = ["low", "medium", "high", "urgent"];
/** Sorting rank: urgent first */
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** View tabs. "cards" keeps its v0 id and is labelled Tracker (plan §13, decision 4). */
export const VIEW_LABEL: Readonly<Record<ViewKind, string>> = {
  cards: "Tracker",
  board: "Board",
  timeline: "Timeline",
  focus: "Focus",
  team: "Team",
  brief: "Brief",
};

export const SORT_LABEL: Readonly<Record<SortKey, string>> = {
  manual: "Workflow",
  priority: "Priority",
  progress: "Progress",
  status: "Status",
  title: "Name",
  estimate: "Duration",
  due: "Due date",
};
/**
 * Every sort, in menu order. `/demo`'s menu keeps v0's six (`SORT_ORDER` without "due"): the demo
 * can't set due dates until Phase 3.
 */
export const SORT_ORDER: readonly SortKey[] = ["manual", "priority", "progress", "status", "title", "estimate", "due"];

/** Brief section headings */
export const SECTION_LABEL: Readonly<Record<BriefSection, string>> = {
  note: "Note",
  done: "Done",
  moving: "In progress",
  next: "Next",
  risks: "Risks",
  questions: "Open questions",
};
/** The brief's sections, top to bottom */
export const SECTION_ORDER: readonly BriefSection[] = ["note", "done", "moving", "next", "risks", "questions"];

/** The "Type" capsule of the project form (FORM-v1 §6.2), in its order */
export const PROJECT_KIND_LABEL: Readonly<Record<ProjectKind, string>> = {
  website: "Website",
  "brand-identity": "Brand identity",
  campaign: "Campaign",
  product: "Product",
  other: "Other",
};
export const PROJECT_KIND_ORDER: readonly ProjectKind[] = ["website", "brand-identity", "campaign", "product", "other"];

export const PROJECT_STATUS_LABEL: Readonly<Record<ProjectStatus, string>> = {
  planning: "Planning",
  active: "Active",
  "on-hold": "On hold",
  done: "Done",
};
export const PROJECT_STATUS_ORDER: readonly ProjectStatus[] = ["planning", "active", "on-hold", "done"];
