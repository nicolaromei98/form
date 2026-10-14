// Test-only lowering of v0 operations to v2 registry ops (plan §4.5, §10.4).
// The golden parser test compares applyV2(fastParse(cmd)) with applyV2(lower(legacyParse(cmd))).
// This is the step 1 stub: the signature is fixed now, and step 15 implements the exhaustive
// switch over the 35 v0 names and narrows the placeholder types below to the v2 ones.
import { OperationSchema, type Doc, type Operation } from "./v0/lib/schema";

/** A v0 operation name. */
export type LegacyOpName = Operation["op"];

/** The 35 v0 operation names, read from the frozen schema. */
export const LEGACY_OP_NAMES: readonly LegacyOpName[] = OperationSchema.options.map((o) => o.shape.op.value);

/** Everything the lowering reads. Step 15 narrows `state`, `idMap` and `mint` to the v2 types. */
export interface LowerContext {
  /** The v0 document the legacy parser read. */
  legacy: Doc;
  /** The v0 selection the command referred to ("this", "it"). */
  selectedId: string | null;
  /** The v2 state the lowered ops apply to: `DocsState` from `src/lib/store/engine.ts`. */
  state: unknown;
  /** v0 id → v2 id, from the migration of `legacy` (`IdMap` from `src/lib/migrate/v0/idmap.ts`). */
  idMap: unknown;
  /** Mints the ids the lowered ops carry (`Minter` from `src/lib/domain/ids.ts`; seeded in tests). */
  mint: unknown;
}

/** What one legacy interpretation becomes: registry ops plus local intents (show, select, zoom). */
export interface Lowered {
  ops: unknown[];
  local: unknown[];
}

export function lower(ops: readonly Operation[], ctx: LowerContext): Lowered {
  throw new Error(`lower() is a stub until Phase 1 step 15 (asked for ${ops.length} op(s) on "${ctx.legacy.tool?.title ?? "no project"}")`);
}
