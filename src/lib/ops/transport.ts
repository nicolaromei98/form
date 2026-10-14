/**
 * The §9.4 transport vocabulary (FORM-v1 §9.4, plan §4.1): one strict tool per op family, the
 * small set the model sees in Phase 5. Each registry op and local intent names the tool that
 * carries it (`transport`), or says why none does. Phase 5 adds the converters from tool calls to
 * registry ops; Phase 1 only fixes the names, so the completeness test can prove every tool has
 * an owner.
 */
export const TRANSPORT_TOOLS = [
  "project_edit",
  "task_add",
  "task_edit",
  "task_remove",
  "task_dependency",
  "step_edit",
  "view",
  "view_option",
  "block",
  "focus",
  "person_edit",
  "assign",
  "propose",
  "proposal",
  "brief",
  "moodboard",
  "navigate",
  "project_draft",
  "clarify",
  "decline",
] as const;

export type TransportTool = (typeof TRANSPORT_TOOLS)[number];

/**
 * Tools no op or local intent claims, with the reason. `clarify` and `decline` are replies, never
 * changes. `navigate` moves between projects and the index, which Phase 3 builds; until then the
 * only navigation is the local `show` intent inside one project.
 */
export const UNCLAIMED_TOOLS: Readonly<Partial<Record<TransportTool, { reason: string; until?: number }>>> = {
  clarify: { reason: "A clarifying question is a reply, never a change to a document." },
  decline: { reason: "Declining is a reply, never a change to a document." },
  navigate: { reason: "Moving between projects and the index needs the Phase 3 index UI.", until: 3 },
};
