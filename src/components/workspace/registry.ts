import type { ComponentType } from "react";
import type { BlockKind } from "@/lib/domain/schema/primitives";
import { CollectionBlock, HeaderBlock, MetricsBlock, ProgressBlock } from "./blocks";
import { MoodboardBlock } from "./Moodboard";
import { CostTag, EditableText, EstimateControl, NumberBadge, PriorityControl, ProgressControl, ProposalBlock, StatusControl, SubtaskList } from "./parts";
import { TaskCard } from "./TaskCard";
import { CardsView } from "./CardsView";
import { BoardView } from "./BoardView";
import { TimelineView } from "./TimelineView";
import { FocusView } from "./FocusView";
import { TeamView } from "./TeamView";
import { BriefView } from "./BriefView";

/**
 * Component registry. The intelligence layer never emits JSX — it emits
 * operations that reference these registered blocks, representations and
 * field components by name.
 */
export const BLOCKS: Readonly<Record<BlockKind, ComponentType | null>> = {
  header: HeaderBlock,
  metrics: MetricsBlock,
  progress: ProgressBlock,
  collection: CollectionBlock,
  moodboard: MoodboardBlock,
  // In the schema already, with no surface until a later phase: the workspace skips them
  budget: null,
  activity: null,
};

export const REPRESENTATIONS = {
  cards: CardsView,
  board: BoardView,
  timeline: TimelineView,
  focus: FocusView,
  team: TeamView,
  brief: BriefView,
} as const;

export const COMPONENTS = {
  "editable-card": TaskCard,
  "text-block": EditableText,
  "status-field": StatusControl,
  "priority-field": PriorityControl,
  "progress-bar": ProgressControl,
  "estimate-field": EstimateControl,
  "cost-field": CostTag,
  "selection-handle": NumberBadge,
  "task-list": SubtaskList,
  proposal: ProposalBlock,
} as const;
