import { detectV0 } from "@/lib/migrate/v0/schema";

/**
 * Where v0 kept its document (plan §7, §7.1). The migration reads these keys and never writes or
 * removes them: the Phase 2 importer reads them again.
 */
export const V0_KEY = "form.workspace.v1";
/** The safety patch's copy (`{ doc, log }`) of a save v0 couldn't read */
export const V0_BACKUP_KEY = `${V0_KEY}.backup`;

export type V0Source = "main" | "backup";

export interface V0Read {
  /**
   * The parsed stored value: the zustand envelope (`{ state: { doc, log }, version }`), a bare
   * document, or the backup (`{ doc, log }`). `migrateV0` unwraps all three, and reads the log for
   * the change count.
   */
  raw: unknown;
  source: V0Source;
}

/** The parsed value under a key; undefined when it is missing, unreadable or not JSON */
function parsed(storage: Pick<Storage, "getItem">, key: string): unknown {
  let text: unknown;
  try {
    text = storage.getItem(key);
  } catch {
    // Blocked storage reads as missing
    return undefined;
  }
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The v0 document in this browser (plan §7.1): the main key when it holds a v0 document, else the
 * backup; null when neither does. Reads only, through `getItem`, so it can't write either key, and
 * never throws. Runs before any store hydrates.
 */
export function readV0(storage: Pick<Storage, "getItem">): V0Read | null {
  const main = parsed(storage, V0_KEY);
  if (detectV0(main)) return { raw: main, source: "main" };
  const backup = parsed(storage, V0_BACKUP_KEY);
  if (detectV0(backup)) return { raw: backup, source: "backup" };
  return null;
}
