import type { ProjectId } from "@/lib/domain/schema/ids";
import type { LocalViewState } from "@/lib/domain/schema/local";
import type { ViewKind } from "@/lib/domain/schema/primitives";
import type { CommandResult } from "@/lib/ops/command";

/**
 * The motion signal of a change (plan §8.1, ported from v0 `fxFor`). Components read it to pick
 * a choreography: the birth of a project, a shift between views, a reflow of the layout, an edit
 * in place, or a restore after undo and redo. `seq` grows with every signal, so the same kind
 * twice in a row still triggers.
 */

export type FxKind = "create" | "shift" | "reflow" | "edit" | "restore";

export interface Fx {
  readonly kind: FxKind;
  readonly seq: number;
  /** The view on screen before the change, or null without a project */
  readonly from: ViewKind | null;
  /** The view this change created (its tab grows in), if any */
  readonly added: ViewKind | null;
}

/** A spawn rectangle (the creation choreography's card slots), in viewport pixels */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const INITIAL_FX: Fx = Object.freeze({ kind: "edit", seq: 0, from: null, added: null });

/** Ops whose change is a layout reflow rather than an edit */
const REFLOW = new Set(["setView", "addBlock", "removeBlock"]);

/** The created view the ink should travel to: the one now on screen, else the first */
export function addedView(added: readonly ViewKind[], active: ViewKind | null): ViewKind | null {
  return added.find((v) => v === active) ?? added[0] ?? null;
}

export interface FxSide {
  projectId: ProjectId | null;
  local: LocalViewState;
}

/**
 * The fx of a command (v0 `fxFor`):
 * - create when createProject applied;
 * - shift when the active view changed (a show, or the view on screen was removed);
 * - reflow for setView, addBlock and removeBlock;
 * - edit otherwise.
 */
export function fxFor(result: Pick<CommandResult, "outcomes" | "addedViews" | "projectId" | "local">, before: FxSide, seq: number): Fx {
  const applied = new Set(result.outcomes.filter((o) => o.result.kind === "applied").map((o) => o.def?.name));
  const from = before.projectId === null ? null : before.local.activeView;
  const added = addedView(result.addedViews, result.projectId === null ? null : result.local.activeView);
  if (applied.has("createProject")) return { kind: "create", seq, from: null, added: null };
  const sameProject = before.projectId !== null && before.projectId === result.projectId;
  if (sameProject && before.local.activeView !== result.local.activeView) return { kind: "shift", seq, from, added };
  if ([...applied].some((name) => name !== undefined && REFLOW.has(name))) return { kind: "reflow", seq, from, added };
  return { kind: "edit", seq, from, added };
}

/** The fx of a tab switch: a shift with nothing added */
export function shiftFx(from: ViewKind, seq: number): Fx {
  return { kind: "shift", seq, from, added: null };
}

/**
 * The fx of undo and redo: a restore. `added` is a view the step brings back on the same project
 * (its tab grows in again), preferring the one on screen.
 */
export function restoreFx(
  before: { projectId: ProjectId | null; local: LocalViewState; views: readonly ViewKind[] },
  after: { projectId: ProjectId | null; local: LocalViewState; views: readonly ViewKind[] },
  seq: number,
): Fx {
  const from = before.projectId === null ? null : before.local.activeView;
  const back = before.projectId !== null && before.projectId === after.projectId ? after.views.filter((v) => !before.views.includes(v)) : [];
  return { kind: "restore", seq, from, added: addedView(back, after.projectId === null ? null : after.local.activeView) };
}
