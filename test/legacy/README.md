# Frozen v0 code (test-only)

`v0/` holds byte-for-byte copies of the v0 modules at commit `b201af8`, so the golden tests can compare the v2 engine with what `/demo` did before Phase 1, even after step 18 deletes the originals.

| Copy | Source at `b201af8` |
|---|---|
| `v0/lib/{schema,ops,seed,selectors,focus,team,views,brief,mood}.ts` | `src/lib/` |
| `v0/lib/interpret/{demo,library}.ts` | `src/lib/interpret/` |
| `v0/components/agent/suggestions.ts` | `src/components/agent/` |

- The only edit is in `suggestions.ts`: its two `@/lib/…` imports point at `../../lib/…`, so nothing here imports app code.
- The store, the Claude path and the React-bound modules are not copied.
- Never edit these files. Check one with `git show b201af8:src/lib/ops.ts | diff - test/legacy/v0/lib/ops.ts`.

`lower.ts` lowers v0 operations to v2 registry ops for the golden parser test (plan §4.5, §10.4). It is a stub until step 15.
