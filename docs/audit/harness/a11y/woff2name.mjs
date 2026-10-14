// Minimal WOFF2 reader: decompress the table stream and print the 'name' table records.
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
const TAGS = ["cmap","head","hhea","hmtx","maxp","name","OS/2","post","cvt ","fpgm","glyf","loca","prep","CFF ","VORG","EBDT","EBLC","gasp","hdmx","kern","LTSH","PCLT","VDMX","vhea","vmtx","BASE","GDEF","GPOS","GSUB","EBSC","JSTF","MATH","CBDT","CBLC","COLR","CPAL","SVG ","sbix","acnt","avar","bdat","bloc","bsln","cvar","fdsc","feat","fmtx","fvar","gvar","hsty","just","lcar","mort","morx","opbd","prop","trak","Zapf","Silf","Glat","Gloc","Feat","Sill"];
for (const file of process.argv.slice(2)) {
  const b = readFileSync(file);
  if (b.toString("latin1", 0, 4) !== "wOF2") { console.log(file, "not woff2"); continue; }
  const numTables = b.readUInt16BE(12);
  const totalCompressed = b.readUInt32BE(20);
  const metaOffset = b.readUInt32BE(28), metaLength = b.readUInt32BE(32);
  let p = 48;
  const base128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const x = b[p++]; v = (v << 7) | (x & 0x7f); if (!(x & 0x80)) return v; } };
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = b[p++];
    let tag = TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) { tag = b.toString("latin1", p, p + 4); p += 4; }
    const tv = (flags >> 6) & 3;
    const orig = base128();
    let len = orig;
    const transformed = (tag === "glyf" || tag === "loca") ? tv === 0 : tv !== 0;
    if (transformed) len = base128();
    dir.push({ tag, len });
  }
  const data = brotliDecompressSync(b.subarray(p, p + totalCompressed));
  let off = 0;
  const at = {};
  for (const t of dir) { at[t.tag] = off; off += t.len; }
  const n = at["name"];
  const count = data.readUInt16BE(n + 2), strOff = data.readUInt16BE(n + 4);
  const want = new Set([0, 7, 8, 9, 11, 12, 13, 14]);
  const seen = new Set();
  console.log("\n#", file.split("/").pop(), "| metadata block:", metaLength ? "yes" : "none");
  for (let i = 0; i < count; i++) {
    const r = n + 6 + i * 12;
    const plat = data.readUInt16BE(r), id = data.readUInt16BE(r + 6), len = data.readUInt16BE(r + 8), o = data.readUInt16BE(r + 10);
    if (!want.has(id) || seen.has(id)) continue;
    const raw = data.subarray(n + strOff + o, n + strOff + o + len);
    const s = plat === 3 || plat === 0 ? Buffer.from(raw).swap16().toString("utf16le") : raw.toString("latin1");
    seen.add(id);
    console.log(`  nameID ${id}:`, s.replace(/\s+/g, " ").slice(0, 400));
  }
  const os2 = at["OS/2"];
  if (os2 != null) {
    const fsType = data.readUInt16BE(os2 + 8);
    const vendor = data.toString("latin1", os2 + 58, os2 + 62);
    console.log(`  OS/2 fsType: 0x${fsType.toString(16).padStart(4, "0")} · achVendID: '${vendor}'`);
  }
}
