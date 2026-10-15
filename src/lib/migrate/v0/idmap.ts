import type { IdKind, Minter } from "@/lib/domain/ids";
import type { AssetId, BriefLineId, MoodItemId, PersonId, ProjectId, ProposalId, StepId, TaskId } from "@/lib/domain/schema/ids";
import { BriefEditKey } from "@/lib/domain/schema/project";
import { show } from "@/lib/migrate/v0/schema";

/**
 * The v0 → v2 id map (plan §7.2 step 2, Q10). Every v0 id is re-minted once, all at once, and every
 * reference (owners, order, parents, the proposal, brief keys, image keys) is rewritten through
 * this map, so no v0 id survives in a v2 document.
 *
 * | v0                               | v2                                                  |
 * |----------------------------------|-----------------------------------------------------|
 * | `tool-*`                         | `prj_`                                              |
 * | `t-*` (top level, promoted)      | `tsk_`                                              |
 * | `t-*` / `s-*` / `p-*` (steps)    | `stp_`                                              |
 * | `p-*` (people)                   | `per_`; demo mode maps the sample team to its ids   |
 * | `m-*`                            | `mdi_`                                              |
 * | `b-*`                            | `brl_`                                              |
 * | proposal items (`p-*`)           | `stp_`: they clash with the person prefix in v0     |
 * | `img-*`                          | `ast_`, kept as an alias of the IndexedDB key       |
 *
 * The migration mints in a fixed order, so a seeded minter gives stable snapshots: the project;
 * the tasks in workflow order (top level, then promoted); the steps, by task, in step order; the
 * people in array order; the mood items in array order, each new image key right after its item;
 * the brief lines; the proposal, then its items.
 */

/** v0 id → v2 id, per kind of entity. v0 ids are only unique within a kind. */
export interface IdMap {
  /** The v0 tool id → the project */
  project: Readonly<Record<string, ProjectId>>;
  /** v0 task ids that became tasks: the top-level ones and the promoted steps */
  tasks: Readonly<Record<string, TaskId>>;
  /** v0 task ids that became steps */
  steps: Readonly<Record<string, StepId>>;
  /** v0 person ids → the person they became: new, a sample person, or one already in the workspace */
  people: Readonly<Record<string, PersonId>>;
  moodItems: Readonly<Record<string, MoodItemId>>;
  briefLines: Readonly<Record<string, BriefLineId>>;
  /** The kept proposal's id, if any */
  proposal: ProposalId | null;
  /** v0 proposal item ids → the steps accepting them would create */
  proposalItems: Readonly<Record<string, StepId>>;
  /** Legacy IndexedDB keys ("img-…") → asset ids */
  assets: Readonly<Record<string, AssetId>>;
}

type MapKind = Exclude<keyof IdMap, "proposal">;

const KIND_OF = {
  project: "project",
  tasks: "task",
  steps: "step",
  people: "person",
  moodItems: "moodItem",
  briefLines: "briefLine",
  proposalItems: "step",
  assets: "asset",
} as const satisfies Readonly<Record<MapKind, IdKind>>;

/** The id type a map holds */
type IdIn<K extends MapKind> = IdMap[K] extends Readonly<Record<string, infer I>> ? I : never;

/** Builds the map while the migration mints, in the order documented above */
export class IdMapBuilder {
  private readonly maps: { [K in MapKind]: Map<string, IdIn<K>> } = {
    project: new Map(),
    tasks: new Map(),
    steps: new Map(),
    people: new Map(),
    moodItems: new Map(),
    briefLines: new Map(),
    proposalItems: new Map(),
    assets: new Map(),
  };
  private proposal: ProposalId | null = null;

  constructor(private readonly mint: Minter) {}

  /** Mints a fresh id for a v0 id. A v0 id met twice keeps its first mapping; the new entity still gets its own id. */
  fresh<K extends MapKind>(kind: K, v0Id: string): IdIn<K> {
    const id = this.mint(KIND_OF[kind]) as IdIn<K>;
    this.link(kind, v0Id, id);
    return id;
  }

  /** Maps a v0 id to an id that already exists (a sample person, a person already in the workspace) */
  link<K extends MapKind>(kind: K, v0Id: string, id: IdIn<K>): void {
    const map = this.maps[kind];
    if (!map.has(v0Id)) map.set(v0Id, id);
  }

  /** The id of an image key: the same key always gives the same asset */
  asset(legacyKey: string): AssetId {
    return this.get("assets", legacyKey) ?? this.fresh("assets", legacyKey);
  }

  mintProposal(): ProposalId {
    return (this.proposal = this.mint("proposal"));
  }

  get<K extends MapKind>(kind: K, v0Id: string): IdIn<K> | undefined {
    return this.maps[kind].get(v0Id);
  }

  /** Forgets entities that didn't make it into the document */
  forget(kind: MapKind, v0Id: string): void {
    this.maps[kind].delete(v0Id);
  }

  dropProposal(): void {
    this.proposal = null;
    this.maps.proposalItems.clear();
  }

  build(): IdMap {
    const record = <K extends MapKind>(kind: K) => Object.fromEntries(this.maps[kind]) as Record<string, IdIn<K>>;
    return {
      project: record("project"),
      tasks: record("tasks"),
      steps: record("steps"),
      people: record("people"),
      moodItems: record("moodItems"),
      briefLines: record("briefLines"),
      proposal: this.proposal,
      proposalItems: record("proposalItems"),
      assets: record("assets"),
    };
  }
}

/** An empty map: nothing was migrated */
export function emptyIdMap(): IdMap {
  return { project: {}, tasks: {}, steps: {}, people: {}, moodItems: {}, briefLines: {}, proposal: null, proposalItems: {}, assets: {} };
}

/** The demo envelope's `assetAliases` (plan §3.6): asset id → the legacy IndexedDB key, so no blob is copied */
export function assetAliases(map: Pick<IdMap, "assets">): Record<AssetId, string> {
  const out = {} as Record<AssetId, string>;
  for (const [legacyKey, id] of Object.entries(map.assets)) out[id] = legacyKey;
  return out;
}

/** What a brief key may name */
export interface BriefKeyLookup {
  task(v0Id: string): TaskId | undefined;
  person(v0Id: string): PersonId | undefined;
}

/** Sentence ids whose last segment is a word, not an entity: `moving:none`, `risks:none` */
const FIXED_SEGMENTS: ReadonlySet<string> = new Set(["none"]);

/**
 * Rewrites a v0 brief edit key ("<audience>:<sentence id>") segment by segment (plan §7.2 step 9).
 * Three sentence ids embed an entity: `moving:<task>`, `risks:<task>` and `risks:load:<person>`.
 * Every other id (`done:all`, `head:focus`, `questions:owners`…) is the same in v2. Returns the
 * new key, or why the edit can't be kept: its entity is gone, or the key isn't one v2 accepts.
 */
export function rewriteBriefKey(key: string, lookup: BriefKeyLookup): { key: string } | { why: string } {
  const [audience, section, ...rest] = key.split(":");
  if (audience !== "client" && audience !== "team") return { why: "it is written for no known audience" };
  let next = key;
  if ((section === "moving" || section === "risks") && rest.length === 1 && !FIXED_SEGMENTS.has(rest[0])) {
    const task = lookup.task(rest[0]);
    if (!task) return { why: `the task it is about, ${show(rest[0])}, is no longer a task in the project` };
    next = `${audience}:${section}:${task}`;
  } else if (section === "risks" && rest.length === 2 && rest[0] === "load") {
    const person = lookup.person(rest[1]);
    if (!person) return { why: `the person it is about, ${show(rest[1])}, isn't in the team` };
    next = `${audience}:risks:load:${person}`;
  }
  return BriefEditKey.safeParse(next).success ? { key: next } : { why: "it doesn't name a brief sentence" };
}
