import { describe, expect, it } from "vitest";
import { getBannerWidth, renderBannerRows } from "../src/grade-banner";

const SHADOW_GLYPH_ROW = /^[█╔╗╚╝═║ ]+$/;

describe("renderBannerRows", () => {
  it("renders six rows built only from shadowed block characters", () => {
    for (const text of ["A 90/100", "F 32/100", "C 75/100", "D 68/100"]) {
      const rows = renderBannerRows(text);

      expect(rows).not.toBeNull();
      expect(rows).toHaveLength(6);
      for (const row of rows ?? []) {
        expect(row).toMatch(SHADOW_GLYPH_ROW);
        expect(row).toBe(row.trimEnd());
      }
    }
  });

  it("returns null for characters outside the glyph set", () => {
    expect(renderBannerRows("n/a")).toBeNull();
    expect(renderBannerRows("F+")).toBeNull();
  });

  it("is deterministic for identical input", () => {
    expect(renderBannerRows("F 32/100")).toEqual(renderBannerRows("F 32/100"));
  });

  it("reports the rendered width of the widest row", () => {
    const text = "F 32/100";
    const rows = renderBannerRows(text);
    const widestRow = Math.max(...(rows ?? []).map((row) => row.length));

    expect(getBannerWidth(text)).toBeGreaterThanOrEqual(widestRow);
  });
});
