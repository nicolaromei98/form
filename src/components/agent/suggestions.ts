import type { ViewKind } from "@/lib/domain/schema/primitives";
import type { PaletteGroupState } from "@/lib/store/hooks";

/**
 * The agent's own wording (plan §8.2). The suggestion chips come from `useSuggestions()` and the
 * command palette from `usePalette()` (lib/store/hooks); what stays here is how a node offers a view
 * and how the palette says what a group still needs.
 */

/**
 * Each view as something to create: the command a suggestion node runs. The same phrases as the
 * store's chips (`lib/store/suggestions`, where a test runs each one through the parser); a test
 * here keeps the two equal.
 */
export const VIEW_OFFER: Readonly<Record<ViewKind, string>> = {
  cards: "Add the tracker",
  board: "Add a board",
  timeline: "Add a timeline",
  team: "Add the team view",
  focus: "Add focus",
  brief: "Add a brief",
};

/** What a palette group still needs, by the group's need (v0 REQUIREMENT_HINT, same wording) */
export const REQUIREMENT_HINT: Readonly<Record<PaletteGroupState["needs"], string>> = {
  none: "",
  project: "Create a project first",
  selection: "Select a task first",
};
