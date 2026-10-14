import { z } from "zod";
import {
  defineOp,
  type Exempt,
  type OpDef,
  reject,
  type Scope,
  type StubFamily,
  type TransportSpec,
  type V0OpName,
} from "@/lib/ops/registry/_contract";

/**
 * Step 9 ships every op as a file, so `registry/index.ts` and `test/property/gen/index.ts` never
 * change again and the step 10 families work in parallel on their own files only
 * (`registry/README.md`). A stub carries what plan §4.4 already fixes (scope, activity, the v0
 * names it folds in, the transport tool); its family replaces the whole file with a real
 * `defineOp`. Delete this file once no op imports it.
 */

/** Stubs must be gone in Phase 1 (`src/lib/phase.ts` FORM_PHASE; pure modules can't import it) */
const STUB_UNTIL = 1;

export interface StubSpec<N extends string, S extends Scope> {
  name: N;
  scope: S;
  family: StubFamily;
  /** "hide" only for setView, setFocus and rebalanceOrder (plan §4.4) */
  activity?: "show" | "hide";
  deprecates: readonly V0OpName[];
  transport: TransportSpec | Exempt;
}

/** A stub op: `{ op }` alone parses, and the recipe refuses with `unknown_op` */
export function stubOp<const N extends string, S extends Scope>(spec: StubSpec<N, S>): OpDef<N, S, { op: N }> {
  const pending: Exempt = { exempt: `Stub: Phase 1 step ${spec.family} implements ${spec.name}`, until: STUB_UNTIL };
  return defineOp<N, S, { op: N }>({
    name: spec.name,
    scope: spec.scope,
    schema: z.object({ op: z.literal(spec.name) }).strict() as unknown as z.ZodType<{ op: N }>,
    reduce: () => reject("unknown_op", "FORM can't make that change yet."),
    caption: () => null,
    noopCaption: () => null,
    undoable: true,
    activity: spec.activity ?? "show",
    idempotent: false,
    deprecates: spec.deprecates,
    parser: pending,
    palette: pending,
    transport: spec.transport,
    sample: () => {
      throw new Error(`${spec.name} is a stub until Phase 1 step ${spec.family}`);
    },
    stub: { family: spec.family, until: STUB_UNTIL },
  });
}
