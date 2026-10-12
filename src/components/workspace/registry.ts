import type { ComponentType } from "react";
import type { BlockType } from "@/lib/schema";
import { CollectionBlock, HeaderBlock, MetricsBlock, ProgressBlock } from "./blocks";
import { MoodboardBlock } from "./Moodboard";
import { CostTag, EditableText, EstimateControl, NumberBadge, PriorityControl, ProgressControl, ProposalBlock, StatusControl, SubtaskList } from "./parts";
import { TaskCard } from "./TaskCard";
import { CardsView } from "./CardsView";
import { BoardView } from "./BoardView";
import { TimelineView } from "./TimelineView";
import { FocusView } from "./FocusView";

/**
 * Component registry. The intelligence layer never emits JSX — it emits
 * operations that reference these registered blocks, representations and
 * field components by name.
 */
export const BLOCKS: Record<BlockType, ComponentType> = {
  header: HeaderBlock,
  metrics: MetricsBlock,
  progress: ProgressBlock,
  collection: CollectionBlock,
  moodboard: MoodboardBlock,
};

export const REPRESENTATIONS = {
  cards: CardsView,
  board: BoardView,
  timeline: TimelineView,
  focus: FocusView,
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
