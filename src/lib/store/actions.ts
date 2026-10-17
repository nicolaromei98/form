import { isImageFile, ingestImage } from "@/lib/assets";
import { addDays } from "@/lib/domain/dates";
import { MOOD_ADD_MAX } from "@/lib/domain/limits";
import type { AssetId, BriefLineId, MoodItemId, PersonId, ProjectId, StepId, TaskId } from "@/lib/domain/schema/ids";
import type { Audience, BirthView, BriefSection } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import { addSampleTeam, createDemoProject } from "@/lib/demo/seed";
import { addTaskOp, makeOp, type Op } from "@/lib/ops/build";
import type { CommandResult } from "@/lib/ops/command";
import type { CommitMeta, FormState, FormStore } from "@/lib/store/form";

/**
 * The action creators (plan §8.1): everything components may do to the demo. The store's own
 * actions are passed through, and the creators below mint the ids their ops carry (the reducer
 * never mints one), so a component never builds an id. Components import this module for types
 * only and get the object from `useActions()`.
 */

export type { Op, OpName, OpOf } from "@/lib/ops/build";
export type { LocalIntent } from "@/lib/ops/local-intents";
export type { CommitMeta, Phase, StoreCaption } from "@/lib/store/form";
export type { Fx, FxKind, Rect } from "@/lib/store/fx";

/** Dropped images land as a row of this width (board-width units), as in v0 */
const DROP_W = 0.24;
const DROP_GAP = 0.018;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Where a dropped or placed reference goes, in board-width units */
export interface BoardPoint {
  x: number;
  y: number;
}

export type Actions = ReturnType<typeof makeActions>;

export function makeActions(store: FormStore) {
  const state = () => store.getState();
  const mint = store.deps.mint;
  const project = (): ProjectDoc | null => {
    const s = state();
    return s.activeProjectId !== null && Object.hasOwn(s.docs.projects, s.activeProjectId) ? s.docs.projects[s.activeProjectId] : null;
  };
  const applied = (r: CommandResult) => r.changed;
  /** The id when the command applied, else null */
  const minted = <T>(r: CommandResult, id: T): T | null => (applied(r) ? id : null);

  const commit = (ops: readonly Op[], meta: CommitMeta) => state().commit(ops, meta);

  return {
    /**
     * The session state an event handler reads at the moment it runs (FormApp's keyboard
     * shortcuts), without subscribing a component to it
     */
    peek: (): Readonly<Pick<FormState, "intro" | "composerOpen" | "phase">> & { selectedTaskId: TaskId | null } => {
      const s = state();
      return { intro: s.intro, composerOpen: s.composerOpen, phase: s.phase, selectedTaskId: s.local.selectedTaskId };
    },

    /* The store's own actions */
    submit: (text: string) => state().submit(text),
    commit,
    beginGesture: () => state().beginGesture(),
    live: (ops: readonly Op[]) => state().live(ops),
    endGesture: () => state().endGesture(),
    cancelGesture: () => state().cancelGesture(),
    showView: (view: FormState["local"]["activeView"]) => state().showView(view),
    select: (id: TaskId | null) => state().select(id),
    resolveProposal: (accept: boolean, only?: readonly string[]) => state().resolveProposal(accept, only),
    undo: () => state().undo(),
    redo: () => state().redo(),
    reset: () => state().reset(),
    openComposer: () => state().openComposer(),
    closeComposer: () => state().closeComposer(),
    dismissCaption: () => state().dismissCaption(),
    setSpawn: (rects: FormState["spawn"]) => state().setSpawn(rects),
    setReducedMotion: (v: boolean) => state().setReducedMotion(v),
    setIntro: (open: boolean) => state().setIntro(open),

    /* Creators that mint ids */

    /** A To-do task at the end of the workflow (EmptyFilter's "New task") */
    addTaskAtEnd(title = "New task"): TaskId | null {
      const taskId = mint("task");
      return minted(commit([addTaskOp({ taskId, title })], { label: "add task" }), taskId);
    },

    /** A step at the end of a task's list */
    addStep(taskId: TaskId, title: string): StepId | null {
      const stepId = mint("step");
      return minted(commit([makeOp({ op: "addStep", taskId, stepId, title, estimateDays: null, after: "end" })], { label: "add step" }), stepId);
    },

    /**
     * Images from a drop, a paste or the file picker (at most 24): stored in IndexedDB under fresh
     * `ast_` ids, then added in one command. A drop lands as one row centred under the pointer;
     * the rest find free spots (v0 geometry).
     */
    async addImages(files: readonly File[], at?: BoardPoint): Promise<MoodItemId[]> {
      const images = files.filter(isImageFile).slice(0, MOOD_ADD_MAX);
      if (images.length === 0) return [];
      const done = await Promise.all(images.map((f) => ingestImage(f, mint("asset"))));
      const w = Math.min(DROP_W, (0.94 - (done.length - 1) * DROP_GAP) / done.length);
      const rowW = done.length * w + (done.length - 1) * DROP_GAP;
      const rowH = Math.max(...done.map((d) => d.aspect * w));
      const x0 = at ? clamp(at.x - rowW / 2, 0.03, 0.97 - rowW) : 0;
      const items = done.map(({ asset, aspect }, i) => {
        const itemId = mint("moodItem");
        const assetId = asset as AssetId;
        return at
          ? { itemId, kind: "image" as const, assetId, w, h: w * aspect, x: x0 + i * (w + DROP_GAP), y: Math.max(0.03, at.y - rowH / 2) }
          : { itemId, kind: "image" as const, assetId, w: DROP_W, h: DROP_W * aspect };
      });
      const r = commit([makeOp({ op: "addMoodItems", items })], { label: `add ${items.length} image${items.length > 1 ? "s" : ""}` });
      const board = project()?.moodboard.items ?? {};
      return applied(r) ? items.map((i) => i.itemId).filter((id) => Object.hasOwn(board, id)) : [];
    },

    /** A colour swatch, with its name */
    addColour(hex: string, name: string | null, at?: BoardPoint): MoodItemId | null {
      const itemId = mint("moodItem");
      return minted(commit([makeOp({ op: "addMoodItems", items: [{ itemId, kind: "color", hex, text: name, ...at }] })], { label: "add colour" }), itemId);
    },

    /** A note; an empty one waits to be written on the board */
    addNote(text = "", at?: BoardPoint): MoodItemId | null {
      const itemId = mint("moodItem");
      return minted(commit([makeOp({ op: "addMoodItems", items: [{ itemId, kind: "note", text, ...at }] })], { label: "add note" }), itemId);
    },

    /**
     * The Team view's "Add person": a person with a visible, editable 5 days a week (Q3), named
     * "Person {n}" after the project's team, who joins the open project.
     */
    addPerson(): PersonId | null {
      const s = state();
      const p = project();
      const taken = new Set(
        Object.values(s.docs.workspace.people)
          .filter((x) => !x.archived)
          .map((x) => x.name.trim().toLowerCase()),
      );
      let n = (p?.memberIds.length ?? 0) + 1;
      while (taken.has(`person ${n}`)) n++;
      const personId = mint("person");
      const ops: Op[] = [
        makeOp({ op: "addPerson", personId, name: `Person ${n}`, role: null, email: null, capacityDaysPerWeek: 5, dayRateCents: null }),
      ];
      if (p) ops.push(makeOp({ op: "addMember", personId }));
      return minted(commit(ops, { label: "add person" }), personId);
    },

    /** "Use a sample team": Marta, Sara and Luca join, and take their template tasks back */
    addSampleTeam(): boolean {
      const ops = addSampleTeam(state().docs.workspace, project());
      return ops.length > 0 && applied(commit(ops, { label: "sample team" }));
    },

    /** A line of the user's own in the brief */
    addBriefLine(audience: Audience, section: BriefSection, text: string): BriefLineId | null {
      const lineId = mint("briefLine");
      return minted(commit([makeOp({ op: "addBriefLine", lineId, audience, section, text })], { label: "add to brief" }), lineId);
    },

    /** The timeline's ±1 week buttons: a new start date, which is then the user's, not a sample */
    shiftStart(days: number): boolean {
      const p = project();
      if (!p) return false;
      const start = addDays(p.startDate ?? state().today, days);
      return applied(
        commit(
          [
            makeOp({ op: "updateProject", field: "startDate", value: start }),
            makeOp({ op: "updateProject", field: "startConfirmed", value: true }),
          ],
          { label: "start date" },
        ),
      );
    },

    /** A demo project from the website template (what "Create a … for my new website" runs) */
    createDemoProject(title: string, startAs: BirthView, o: { moodboard?: boolean; replace?: boolean } = {}): ProjectId | null {
      const s = state();
      const ops = createDemoProject(
        { workspace: s.docs.workspace, project: project() },
        { title, startAs, wantsMoodboard: o.moodboard ?? false, replace: o.replace ?? false },
        mint,
      );
      const r = commit(ops, { label: `create ${title}`, caption: true });
      return r.spawned.at(-1)?.id ?? null;
    },
  };
}
