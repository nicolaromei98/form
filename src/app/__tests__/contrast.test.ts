// Q14 (plan §9.2): every text token reaches 4.5:1 and every meaningful stroke or red graphic 3:1 on
// the surfaces it sits on. The check reads globals.css and the components' dimmed surfaces, so a
// token or a surface that moves is measured as it is (node scripts/audit/a11y/q14.mjs prints it all).
import { describe, expect, it } from "vitest";
import { run } from "../../../scripts/audit/a11y/q14.mjs";

describe("Q14 contrast tokens", () => {
  const { rows, failures } = run();

  it("measures text, graphics and the audited spots", () => {
    expect(rows.length).toBeGreaterThan(150);
    for (const group of ["text", "text on ink", "graphic", "spot"]) expect(rows.some((r) => r.group === group)).toBe(true);
  });

  it("has no failing pair", () => {
    expect(failures.map((r) => `${r.what} on ${r.on}: ${r.ratio}:1 < ${r.min}:1`)).toEqual([]);
  });

  it("keeps the plan's verified values", () => {
    const min = (what: string) => Math.min(...rows.filter((r) => r.what === what).map((r) => r.ratio));
    // AUDIT §12.1: text-3 at .60 is 4.72 on paper-lo, its darkest surface; text-2 at .72 is 7.00
    expect(min("--text-3")).toBeCloseTo(4.72, 2);
    expect(min("--text-2")).toBeCloseTo(7.0, 2);
    expect(min("--signal-text (.tone-light)")).toBeGreaterThanOrEqual(4.7);
  });
});
