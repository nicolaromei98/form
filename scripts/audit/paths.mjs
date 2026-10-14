// Repo-relative locations shared by the audit harnesses, so every probe runs from any checkout.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Repository root (absolute, trailing slash), resolved from this file's location. */
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Source root, for the `@/` alias the v0 modules use. */
export const SRC = ROOT + "src";

/**
 * The v0 library the Phase 0 audit measured. Phase 1 step 18 deletes it from `src/lib`;
 * frozen copies of its pure modules stay in `test/legacy/v0/lib` (same code, commit b201af8).
 */
export const LIB = ROOT + "src/lib/";

/** A gitignored scratch folder for re-run output that must not overwrite the recorded evidence. */
export function outDir(name) {
  const dir = fileURLToPath(new URL(`./.out/${name}/`, import.meta.url));
  mkdirSync(dir, { recursive: true });
  return dir;
}
