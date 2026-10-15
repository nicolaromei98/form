"use client";

import { createContext, createElement, type ReactNode, useContext, useEffect } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { Brief } from "@/lib/compose/brief";
import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import type { BlockKind, IsoDate, ViewKind } from "@/lib/domain/schema/primitives";
import type { BriefState, MoodItem, ProjectDoc, Step, Task, ViewConfig } from "@/lib/domain/schema/project";
import type { Proposal, SubtasksProposal } from "@/lib/domain/schema/proposal";
import type { Person } from "@/lib/domain/schema/workspace";
import { NEEDS_HINT, type PaletteGroupView, paletteGroups } from "@/lib/ops/palette";
import type { FocusCandidate, FocusResult, LaneLoad, Metrics, ProjectPlan, TaskTiming } from "@/lib/planning";
import type { TimelineGrid } from "@/lib/planning/format";
import { workflowNumbers } from "@/lib/planning/memo";
import { type Actions, makeActions } from "@/lib/store/actions";
import { exposeFormHandle, type FormState, type FormStore, getFormStore, type Phase, type StoreCaption } from "@/lib/store/form";
import type { Fx, Rect } from "@/lib/store/fx";
import {
  selectBrief,
  selectFocusFor,
  selectLaneLoads,
  selectMembers,
  selectMoodItems,
  selectPlan,
  selectProject,
  selectSubtaskProposal,
  selectTaskIds,
  selectTasksByStatus,
  selectTimelineGrid,
  selectVisibleTaskIds,
  type TasksByStatus,
} from "@/lib/store/selectors";
import { suggestionsFor } from "@/lib/store/suggestions";
import { startMidnightTicker, todayFor } from "@/lib/store/today";
import { writeViewToUrl } from "@/lib/store/view-url";

/**
 * The data API of the components (plan §8.1): thin hooks over memoised selectors, so a component
 * subscribes to exactly what it shows and never to the whole state (plan §12.9). Derived values
 * come from the planning engine through `selectors.ts`; every hook returns a stable reference
 * while what it reads is unchanged. Changes go through `useActions()`.
 *
 * The store is the app's (`getFormStore()`), or the one a `FormStoreProvider` gives (tests).
 */

const FormStoreContext = createContext<FormStore | null>(null);

/** Runs the hooks below on another store (tests and stories) */
export function FormStoreProvider({ store, children }: { store: FormStore; children?: ReactNode }) {
  return createElement(FormStoreContext.Provider, { value: store }, children);
}

function useFormStore(): FormStore {
  return useContext(FormStoreContext) ?? getFormStore();
}

function useForm<T>(selector: (s: FormState) => T): T {
  return useStore(useFormStore(), selector);
}

const NO_VIEWS: readonly ViewKind[] = Object.freeze([]);
const NO_BLOCKS: readonly BlockKind[] = Object.freeze([]);
const NO_STEPS: readonly Step[] = Object.freeze([]);

const taskOf = (s: FormState, id: TaskId | null): Task | null => {
  const p = selectProject(s);
  return p !== null && id !== null && Object.hasOwn(p.tasks, id) ? p.tasks[id] : null;
};

/* ------------------------------------------------------------------
   Data
   ------------------------------------------------------------------ */

export const useProject = (): ProjectDoc | null => useForm(selectProject);
export const useHasProject = (): boolean => useForm((s) => selectProject(s) !== null);
export const useProjectTitle = (): string | null => useForm((s) => selectProject(s)?.title ?? null);
export const useViews = (): readonly ViewKind[] => useForm((s) => selectProject(s)?.views ?? NO_VIEWS);
export const useBlocks = (): readonly BlockKind[] => useForm((s) => selectProject(s)?.blocks ?? NO_BLOCKS);
export const useViewConfig = (): ViewConfig | null => useForm((s) => selectProject(s)?.viewConfig ?? null);
export const useActiveView = (): ViewKind => useForm((s) => s.local.activeView);
export const useTask = (id: TaskId | null): Task | null => useForm((s) => taskOf(s, id));
/** Every task id in workflow order */
export const useTaskIds = (): readonly TaskId[] => useForm(useShallow(selectTaskIds));
/** The ids the view shows: filtered and sorted (v0 `visibleTasks`) */
export const useVisibleTaskIds = (): readonly TaskId[] => useForm(useShallow(selectVisibleTaskIds));
/** The visible ids by status: the board's lanes */
export const useTasksByStatus = (): TasksByStatus => useForm(selectTasksByStatus);
/** The workflow number shown on a task ("01"), stable under any sort */
export const useTaskNumber = (id: TaskId): string =>
  useForm((s) => {
    const p = selectProject(s);
    return p ? (workflowNumbers(p.tasks).get(id) ?? "00") : "00";
  });
export const useSteps = (taskId: TaskId): readonly Step[] => useForm((s) => taskOf(s, taskId)?.steps ?? NO_STEPS);
export const useProposal = (): Proposal | null => useForm((s) => selectProject(s)?.proposal ?? null);
export const useSubtaskProposal = (taskId: TaskId): SubtasksProposal | null => useForm((s) => selectSubtaskProposal(s, taskId));
/** The project's members who are in the team */
export const useMembers = (): readonly Person[] => useForm(selectMembers);
export const usePerson = (id: PersonId | null): Person | null =>
  useForm((s) => (id !== null && Object.hasOwn(s.docs.workspace.people, id) ? s.docs.workspace.people[id] : null));
/** Mood items bottom to top */
export const useMoodItems = (): readonly MoodItem[] => useForm(selectMoodItems);
export const useBriefState = (): BriefState | null => useForm((s) => selectProject(s)?.brief ?? null);

/* ------------------------------------------------------------------
   Derived (the planning engine)
   ------------------------------------------------------------------ */

export const usePlan = (): ProjectPlan | null => useForm(selectPlan);
export const useTiming = (id: TaskId): TaskTiming | null => useForm((s) => selectPlan(s)?.schedule.timings.get(id) ?? null);
/** The schedule on the v0 calendar-day grid */
export const useTimelineGrid = (): TimelineGrid | null => useForm(selectTimelineGrid);
export const useMetrics = (): Metrics | null => useForm((s) => selectPlan(s)?.metrics ?? null);
export const useFocus = (): FocusResult | null => useForm((s) => selectPlan(s)?.focus ?? null);
/** A task's focus reasons and why, when it is open and not blocked */
export const useFocusFor = (id: TaskId): FocusCandidate | null => useForm((s) => selectFocusFor(s, id));
/** The Team lanes; with `preview`, as the pending reassign proposal would leave them */
export const useLaneLoads = ({ preview = false }: { preview?: boolean } = {}): readonly LaneLoad[] => useForm((s) => selectLaneLoads(s, preview));
/** The status brief for the view's audience and length */
export const useBrief = (): Brief | null => useForm(selectBrief);
export const useToday = (): IsoDate => useForm((s) => s.today);

/* ------------------------------------------------------------------
   Session
   ------------------------------------------------------------------ */

export const useSelectedId = (): TaskId | null => useForm((s) => s.local.selectedTaskId);
export const useIsSelected = (id: TaskId): boolean => useForm((s) => s.local.selectedTaskId === id);
export const useSelectedTask = (): Task | null => useForm((s) => taskOf(s, s.local.selectedTaskId));
export const usePhase = (): Phase => useForm((s) => s.phase);
/** The creation choreography is running */
export const useIsCreating = (): boolean => useForm((s) => s.phase === "creating" && s.fx.kind === "create");
export const useCaption = (): StoreCaption | null => useForm((s) => s.caption);
export const useComposerOpen = (): boolean => useForm((s) => s.composerOpen);
export const useFx = (): Fx => useForm((s) => s.fx);
export const useSpawn = (): Rect[] | null => useForm((s) => s.spawn);
export const useReducedMotion = (): boolean => useForm((s) => s.reducedMotion);
export const useIntro = (): boolean => useForm((s) => s.intro);
export const useCanUndo = (): boolean => useForm((s) => s.past.length > 0);
export const useCanRedo = (): boolean => useForm((s) => s.future.length > 0);
/** "{n} changes · saved locally" */
export const useChangeCount = (): number => useForm((s) => s.changes);
export const useCommandHistory = (): readonly string[] => useForm((s) => s.commandHistory);
/** The agent's suggestion chips and nodes for where the user is */
export const useSuggestions = (): readonly string[] =>
  useForm(useShallow((s) => suggestionsFor({ project: selectProject(s), ws: s.docs.workspace, local: s.local })));

export interface PaletteGroupState extends PaletteGroupView {
  /** Whether what the group needs is there (a project, a selection) */
  available: boolean;
  /** "Create a project first" / "Select a task first", or "" */
  hint: string;
}

let palette: readonly PaletteGroupView[] | null = null;
const paletteStates = new Map<string, readonly PaletteGroupState[]>();

/** The command palette (`paletteGroups("demo")`), with what each group still needs */
function paletteFor(hasProject: boolean, hasSelection: boolean): readonly PaletteGroupState[] {
  const key = `${hasProject}|${hasSelection}`;
  let out = paletteStates.get(key);
  if (out === undefined) {
    palette ??= paletteGroups("demo");
    out = palette.map((g) => {
      const available = g.needs === "none" || (g.needs === "project" ? hasProject : hasProject && hasSelection);
      return { ...g, available, hint: available ? "" : NEEDS_HINT[!hasProject && g.needs !== "none" ? "project" : g.needs] };
    });
    paletteStates.set(key, out);
  }
  return out;
}

export const usePalette = (): readonly PaletteGroupState[] =>
  useForm((s) => paletteFor(selectProject(s) !== null, taskOf(s, s.local.selectedTaskId) !== null));

/* ------------------------------------------------------------------
   Actions and the runtime
   ------------------------------------------------------------------ */

const actionsByStore = new WeakMap<FormStore, Actions>();

/** Every action and minting creator, as one stable object */
export function useActions(): Actions {
  const store = useFormStore();
  let actions = actionsByStore.get(store);
  if (actions === undefined) actionsByStore.set(store, (actions = makeActions(store)));
  return actions;
}

/**
 * What the app's root runs once (plan §8.2 FormApp): the view in the URL, today re-ticked at
 * local midnight and when the page shows again, a save before the page goes away, and the
 * `window.__form` handle where it is allowed.
 */
export function useFormRuntime(): void {
  const store = useFormStore();
  useEffect(() => {
    exposeFormHandle(store);
    const zone = () => store.getState().docs.workspace.timezone;
    const tick = () => store.getState().tick(todayFor(zone(), store.deps.now()));
    const stopTicker = startMidnightTicker({ timezone: zone, now: store.deps.now, onTick: (d) => store.getState().tick(d) });

    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
      else store.getState().flushSave();
    };
    const onHide = () => store.getState().flushSave();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);

    const writeUrl = (s: FormState) => writeViewToUrl(window, s.activeProjectId === null ? null : s.local.activeView, selectProject(s));
    writeUrl(store.getState());
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.local.activeView !== prev.local.activeView || s.activeProjectId !== prev.activeProjectId || selectProject(s)?.views !== selectProject(prev)?.views) writeUrl(s);
    });

    return () => {
      stopTicker();
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, [store]);
}

export type { Actions, BoardPoint } from "@/lib/store/actions";
export type { Phase, StoreCaption } from "@/lib/store/form";
export type { Fx, FxKind, Rect } from "@/lib/store/fx";
export type { TasksByStatus } from "@/lib/store/selectors";
