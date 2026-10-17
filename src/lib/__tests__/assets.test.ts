// The asset alias fallback (plan §7.3, §12 item 13): a migrated image keeps its blob under the v0
// key, and a lookup by its ast_ id falls back to that key through the registered aliases.
import { afterEach, describe, expect, it } from "vitest";
import { assetKeys, findBlob, setAssetAliases } from "@/lib/assets";

afterEach(() => setAssetAliases({}));

describe("asset aliases", () => {
  it("look up the asset's own key first, then its legacy key", () => {
    setAssetAliases({ ast_0123456789abcdef: "img-fixture1" });
    expect(assetKeys("ast_0123456789abcdef")).toEqual(["ast_0123456789abcdef", "img-fixture1"]);
    expect(assetKeys("ast_ffffffffffffffff")).toEqual(["ast_ffffffffffffffff"]);
  });

  it("find a migrated blob under its legacy key, and a new one under its own", async () => {
    const legacy = new Blob(["v0"]);
    const fresh = new Blob(["v2"]);
    const stored = new Map([
      ["img-fixture1", legacy],
      ["ast_ffffffffffffffff", fresh],
    ]);
    const read = async (key: string) => stored.get(key) ?? null;
    const map = new Map([["ast_0123456789abcdef", "img-fixture1"]]);
    expect(await findBlob(assetKeys("ast_0123456789abcdef", map), read)).toBe(legacy);
    expect(await findBlob(assetKeys("ast_ffffffffffffffff", map), read)).toBe(fresh);
    expect(await findBlob(assetKeys("ast_aaaaaaaaaaaaaaaa", map), read)).toBeNull();
  });

  it("treat a failing read as missing", async () => {
    const read = async () => {
      throw new Error("IndexedDB unavailable");
    };
    expect(await findBlob(["ast_0123456789abcdef"], read)).toBeNull();
  });
});
