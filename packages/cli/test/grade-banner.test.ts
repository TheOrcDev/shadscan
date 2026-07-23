import { describe, expect, it } from "vitest";
import { getBannerWidth, renderBannerRows } from "../src/grade-banner";

const FILL_AND_SPACES_ROW = /^[# ]*#$/;

describe("renderBannerRows", () => {
  it("renders five rows built only from the fill character and spaces", () => {
    for (const text of ["A 90/100", "F 32/100", "C 75/100"]) {
      const rows = renderBannerRows(text, "#");

      expect(rows).not.toBeNull();
      expect(rows).toHaveLength(5);
      for (const row of rows ?? []) {
        expect(row).toMatch(FILL_AND_SPACES_ROW);
      }
    }
  });

  it("returns null for characters outside the glyph set", () => {
    expect(renderBannerRows("n/a", "#")).toBeNull();
    expect(renderBannerRows("F+", "#")).toBeNull();
  });

  it("is deterministic for identical input", () => {
    const first = renderBannerRows("F 32/100", "█");
    const second = renderBannerRows("F 32/100", "█");

    expect(first).toEqual(second);
  });

  it("reports the rendered width of the widest row", () => {
    const text = "F 32/100";
    const rows = renderBannerRows(text, "#");
    const widestRow = Math.max(...(rows ?? []).map((row) => row.length));

    expect(getBannerWidth(text)).toBeGreaterThanOrEqual(widestRow);
  });
});
