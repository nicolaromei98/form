import type { Minter } from "@/lib/domain/ids";
import type { PersonId, TaskId } from "@/lib/domain/schema/ids";
import type { LocalViewState } from "@/lib/domain/schema/local";
import type { BirthView, IsoDate, ViewKind } from "@/lib/domain/schema/primitives";
import type { ProjectDoc } from "@/lib/domain/schema/project";
import type { WorkspaceDoc } from "@/lib/domain/schema/workspace";
import { makeOp, type Op } from "@/lib/ops/build";
import type { Expansion } from "@/lib/ops/caption";
import type { LocalIntent } from "@/lib/ops/local-intents";
import type { NoticeKey } from "@/lib/ops/notices";
import type { QueryNote } from "@/lib/ops/queries";

/**
 * What every family of the fast parser shares (plan §8.4): the context a command is read in, what
 * a family answers, and the collector the accumulating rules write into.
 */

/* ------------------------------------------------------------------
   The context
   ------------------------------------------------------------------ */

/** One step of a breakdown, before its id is minted */
export interface BreakdownStep {
  readonly title: string;
  readonly estimateDays: number | null;
}

/** The /demo breakdown library (Q20, `lib/demo/library.ts`): steps for a task, by its title */
export type Breakdown = (task: { readonly title: string; readonly estimateDays: number | null }) => readonly BreakdownStep[];

/**
 * The /demo expansions (`lib/demo/seed.ts`), injected like the breakdown: the parser never imports
 * lib/demo (plan §2), and /demo is the only surface that creates projects from the website
 * template or brings in a sample team.
 */
export interface DemoExpansions {
  /** `createDemoProject`: replace the open project when asked, bring the sample team in, create */
  createProject(
    state: { workspace: Pick<WorkspaceDoc, "people">; project: Pick<ProjectDoc, "id"> | null },
    req: { title: string; startAs: BirthView; wantsMoodboard: boolean; replace: boolean },
    mint: Minter,
  ): Op[];
  /** `addSampleTeam`: the sample people, their membership and their template tasks */
  sampleTeam(ws: Pick<WorkspaceDoc, "people">, project: Pick<ProjectDoc, "memberIds" | "tasks"> | null): Op[];
}

export interface FastContext {
  ws: WorkspaceDoc;
  /** The active project, or null before the first one */
  project: ProjectDoc | null;
  /**
   * The workspace's live projects, the active one included. Balance reads load across projects
   * (plan §6.6); every other rule reads only the active project.
   */
  projects: readonly ProjectDoc[];
  local: LocalViewState;
  /** The selected task ("this", "it"): Point & Ask */
  selectedTaskId: TaskId | null;
  /** Mints every id the ops carry (plan §8.4) */
  mint: Minter;
  today: IsoDate;
  /** The palette's phrases, normalised with `paletteKey` (Q17: an exact phrase is confidence 1) */
  palette: ReadonlySet<string>;
  breakdown: Breakdown;
  demo: DemoExpansions;
}

/* ------------------------------------------------------------------
   What a family answers
   ------------------------------------------------------------------ */

/**
 * How a rule matched (Q17): an anchored template covers the whole command; a keyword rule found
 * its words somewhere in it. An exact palette phrase outranks both (`confidence.ts`).
 */
export type Tier = "anchored" | "keyword";

export interface Intent {
  ops: Op[];
  local: LocalIntent[];
  notes: QueryNote[];
  notices: NoticeKey[];
  /** A question back (v0 wording), shown instead of the caption; any ops still apply */
  reply?: { tone: "clarify"; text: string };
  /** The demo expansion the ops came from, so the caption speaks for it as one (caption policy rule 3) */
  expansion?: Expansion;
}

export type FamilyResult =
  | { kind: "intent"; tier: Tier; intent: Intent }
  | { kind: "clarify"; tier: Tier; text: string }
  | { kind: "unsupported"; text: string }
  | { kind: "control"; control: "undo" | "redo" | "reset" };

export function clarify(text: string, tier: Tier = "keyword"): FamilyResult {
  return { kind: "clarify", tier, text };
}

export function unsupported(text: string): FamilyResult {
  return { kind: "unsupported", text };
}

export function control(c: "undo" | "redo" | "reset"): FamilyResult {
  return { kind: "control", control: c };
}

/* ------------------------------------------------------------------
   The collector
   ------------------------------------------------------------------ */

/**
 * Ops, local intents, notes and notices in the order the rules found them. Showing a view the
 * project doesn't have adds it first (plan §4.5: v0 setRepresentation → addView, then show), once
 * per command.
 */
export class Collector {
  readonly ops: Op[] = [];
  readonly local: LocalIntent[] = [];
  readonly notes: QueryNote[] = [];
  readonly notices: NoticeKey[] = [];
  private readonly views: Set<ViewKind>;
  private expansion: Expansion | null = null;

  constructor(project: Pick<ProjectDoc, "views"> | null) {
    this.views = new Set(project?.views ?? []);
  }

  op(...ops: Op[]): this {
    this.ops.push(...ops);
    return this;
  }

  /** Adds a view the project doesn't have yet (plan §4.5) */
  private ensureView(view: ViewKind): void {
    if (!this.views.has(view)) {
      this.ops.push(makeOp({ op: "addView", view }));
      this.views.add(view);
    }
  }

  /** Shows a view as the command's intent ("Show the team workload"): the view says its status */
  show(view: ViewKind): this {
    this.ensureView(view);
    this.local.push({ kind: "show", view });
    return this;
  }

  /**
   * Brings a view on screen as a side effect of a change ("assign …" opens the team): nothing when
   * it is already the active view (v0's silent setRepresentation). A reveal says nothing of the
   * view, only "{View} view added" when the command creates it (caption policy rule 4).
   */
  reveal(view: ViewKind, active: ViewKind): this {
    if (view === active) return this;
    this.ensureView(view);
    this.local.push({ kind: "show", view, reveal: true });
    return this;
  }

  /** The ops came from a demo expansion: the caption speaks for it as one (caption policy rule 3) */
  expands(expansion: Expansion): this {
    this.expansion = expansion;
    return this;
  }

  note(note: QueryNote): this {
    this.notes.push(note);
    return this;
  }

  notice(key: NoticeKey): this {
    this.notices.push(key);
    return this;
  }

  /** Whether any rule produced anything (v0: no ops and no notes → unsupported) */
  get empty(): boolean {
    return this.ops.length === 0 && this.local.length === 0 && this.notes.length === 0 && this.notices.length === 0;
  }

  /** Whether a rule already showed a view (v0: a setRepresentation op in the list) */
  get shows(): boolean {
    return this.local.some((l) => l.kind === "show");
  }

  intent(reply?: Intent["reply"]): Intent {
    return {
      ops: [...this.ops],
      local: [...this.local],
      notes: [...this.notes],
      notices: [...this.notices],
      ...(reply ? { reply } : {}),
      ...(this.expansion ? { expansion: this.expansion } : {}),
    };
  }

  result(tier: Tier, reply?: Intent["reply"]): FamilyResult {
    return { kind: "intent", tier, intent: this.intent(reply) };
  }
}

/** A family's intent built in one go */
export function collect(project: Pick<ProjectDoc, "views"> | null, build: (c: Collector) => void, tier: Tier = "keyword", reply?: Intent["reply"]): FamilyResult {
  const c = new Collector(project);
  build(c);
  return c.result(tier, reply);
}

/** A person the parser may name: active in the workspace */
export interface NamedPerson {
  readonly id: PersonId;
  readonly name: string;
}
