// Repo-relative locations shared by the audit harnesses, so every probe runs from any checkout.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Repository root (absolute, trailing slash), resolved from this file's location. */
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Source root, for the `@/` alias the v0 modules use. */
export const SRC = ROOT + "src";

/**
 * The v0 library the Phase 0 audit measured: the frozen copies of its pure modules in
 * `test/legacy/v0/lib` (same code, commit b201af8), since Phase 1 step 18 deleted the originals
 * from `src/lib`. The v0 store, the Claude module and the SDK were not copied: the probes that load
 * them run only on a checkout of a commit before step 18.
 */
export const LIB = ROOT + "test/legacy/v0/lib/";

/** A gitignored scratch folder for re-run output that must not overwrite the recorded evidence. */
export function outDir(name) {
  const dir = fileURLToPath(new URL(`./.out/${name}/`, import.meta.url));
  mkdirSync(dir, { recursive: true });
  return dir;
}
