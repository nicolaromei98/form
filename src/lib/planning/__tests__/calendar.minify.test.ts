// The calendar as the production build ships it. Next 16's minifier (SWC) inlines a single-use
// variable across a call that replaces the array it indexes: `const i = indexOf(d); return
// prefix[i]` became `prefix[indexOf(d)]`, which read the empty starting array, so every ordinal of
// a fresh calendar was undefined and /demo dated nothing. This runs calendar.ts through the same
// minifier and checks the minified calendar against the source one.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { addDays } from "@/lib/domain/dates";
import { IsoDate } from "@/lib/domain/schema/primitives";
import * as source from "@/lib/planning/calendar";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, "package.json"));

interface Swc {
  loadBindings(): Promise<unknown>;
  transform(code: string, options: object): Promise<{ code: string }>;
  minify(code: string, options: object): Promise<{ code: string }>;
}

const dir = mkdtempSync(join(tmpdir(), "form-calendar-min-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** calendar.ts compiled and minified as the production build does it, as a module */
async function minifiedCalendar(): Promise<typeof source> {
  const swc = require("next/dist/build/swc") as Swc;
  await swc.loadBindings();
  const ts = readFileSync(join(ROOT, "src/lib/planning/calendar.ts"), "utf8");
  const js = await swc.transform(ts, {
    filename: "calendar.ts",
    jsc: { parser: { syntax: "typescript" }, target: "es2022" },
    module: { type: "es6" },
  });
  const min = await swc.minify(js.code, { compress: true, mangle: true, module: true });
  // The lib imports point at the source files, which the test runner compiles
  const code = min.code.replace(/(["'])@\/lib\/([^"']+)\1/g, (_, q: string, path: string) => `${q}${join(ROOT, "src/lib", path)}.ts${q}`);
  const file = join(dir, "calendar.min.mjs");
  writeFileSync(file, code);
  return (await import(/* @vite-ignore */ file)) as typeof source;
}

const d = (s: string) => IsoDate.parse(s);

describe("the minified calendar", () => {
  it("answers as the source does from a fresh calendar, in any order of questions", async () => {
    const min = await minifiedCalendar();
    // Closures make each calendar a new one (calendars are memoised by spec)
    const spec = (closure: string) => ({ workingDays: [1, 2, 3, 4, 5], closures: [{ from: d(closure), to: d(closure) }] });
    const days = ["2026-09-28", "2026-10-03", "2026-10-14", "1999-12-31", "2031-06-02"].map(d);

    // A fresh calendar per first question, so every accessor meets an empty horizon first
    const firsts: ((cal: source.WorkCalendar, day: IsoDate) => unknown)[] = [
      (cal, day) => cal.ordinal(day),
      (cal, day) => cal.isWorkingDay(day),
      (cal, day) => cal.nextWorkingDay(day, true),
      (cal, day) => cal.nextWorkingDay(day, false),
      (cal, day) => cal.addWorkingDays(day, 3),
      (cal, day) => cal.workingDaysBetween(day, addDays(day, 20)),
    ];
    let n = 0;
    for (const first of firsts) {
      for (const day of days) {
        const closure = addDays(d("2040-01-01"), n++);
        const a = min.makeCalendar(spec(closure));
        const b = source.makeCalendar(spec(closure));
        expect(first(a, day)).toEqual(first(b, day));
        for (const other of days) {
          expect(a.ordinal(other)).toBe(b.ordinal(other));
          expect(a.isWorkingDay(other)).toBe(b.isWorkingDay(other));
          expect(a.nextWorkingDay(other, true)).toBe(b.nextWorkingDay(other, true));
          expect(a.addWorkingDays(other, -7)).toBe(b.addWorkingDays(other, -7));
        }
      }
    }
    // The demo's sample start: a number, never undefined
    const demo = min.makeCalendar({ workingDays: [1, 2, 3, 4, 5], closures: [{ from: d("2050-01-03"), to: d("2050-01-03") }] });
    expect(typeof demo.ordinal(d("2026-09-28"))).toBe("number");
    expect(demo.dateAt(demo.ordinal(d("2026-09-28")) + 3)).toBe("2026-10-01");
  }, 60_000);
});
