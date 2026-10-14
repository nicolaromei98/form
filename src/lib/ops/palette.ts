import { LOCAL_INTENTS } from "@/lib/ops/local-intents";
import { OP_NAMES, REGISTRY } from "@/lib/ops/registry";
import {
  isExempt,
  PALETTE_GROUPS,
  type PaletteEntry,
  type PaletteGroup,
  type PaletteNeeds,
  type Surface,
} from "@/lib/ops/registry/_contract";

/**
 * The command palette (plan §4.4): built from the registry's and the local intents' palette
 * entries, never written by hand, so a phrase can't outlive the op that runs it. Groups keep the
 * v0 CAPABILITIES order; entries keep their rank (v0 order × 10).
 */

export { PALETTE_GROUPS };

/** An entry with the op or local intent that owns it */
export interface OwnedPaletteEntry extends PaletteEntry {
  owner: string;
}

export interface PaletteGroupView {
  group: PaletteGroup;
  /** What the group needs first: the strongest need of its entries */
  needs: PaletteNeeds;
  items: OwnedPaletteEntry[];
}

/** "Create a project first" / "Select a task first" (v0 REQUIREMENT_HINT) */
export const NEEDS_HINT: Readonly<Record<PaletteNeeds, string>> = {
  none: "",
  project: "Create a project first",
  selection: "Select a task first",
};

const NEED_RANK: Readonly<Record<PaletteNeeds, number>> = { none: 0, project: 1, selection: 2 };

/** Every palette entry of the registry, then of the local intents */
export function paletteEntries(): OwnedPaletteEntry[] {
  const out: OwnedPaletteEntry[] = [];
  for (const name of OP_NAMES) {
    const palette = REGISTRY.get(name)!.palette;
    if (!isExempt(palette)) for (const entry of palette) out.push({ ...entry, owner: name });
  }
  for (const def of Object.values(LOCAL_INTENTS)) {
    if (!isExempt(def.palette)) for (const entry of def.palette) out.push({ ...entry, owner: `local:${def.kind}` });
  }
  return out;
}

/** The palette for a surface, grouped and ranked; empty groups are left out */
export function paletteGroups(surface: Surface): PaletteGroupView[] {
  const entries = paletteEntries().filter((e) => e.surfaces.includes(surface));
  return PALETTE_GROUPS.map((group) => {
    const items = entries.filter((e) => e.group === group).sort((a, b) => a.rank - b.rank || (a.phrase < b.phrase ? -1 : 1));
    const needs = items.reduce<PaletteNeeds>((n, e) => (NEED_RANK[e.needs] > NEED_RANK[n] ? e.needs : n), "none");
    return { group, needs, items };
  }).filter((g) => g.items.length > 0);
}
