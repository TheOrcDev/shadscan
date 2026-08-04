import { describe, expect, it } from "vitest";
import type { NpmStats } from "@/lib/npm-stats";
import { createStatsSocialCopy } from "@/lib/stats-social-copy";

const createStats = (overrides: Partial<NpmStats> = {}): NpmStats => ({
  daily: [],
  firstPublishedDay: "2026-07-22",
  lastWeekDownloads: 9631,
  latestVersion: "0.8.0",
  releases: [],
  totalDownloads: 45_231,
  versionCount: 12,
  versions: [],
  ...overrides,
});

describe("stats social card copy", () => {
  it("cites downloads, version count, and the latest release", () => {
    expect(createStatsSocialCopy(createStats())).toEqual({
      detail: "45.2K downloads  ·  12 versions  ·  v0.8.0 latest",
      footer: "Public npm numbers, refreshed hourly.",
      headline: "shadscan by the numbers.",
    });
  });

  it("falls back to a static description when npm did not answer", () => {
    expect(createStatsSocialCopy(null)).toEqual({
      detail: "npm downloads, version adoption, and repository stats.",
      footer: "Public npm numbers, refreshed hourly.",
      headline: "shadscan by the numbers.",
    });
  });

  it("keeps the card renderable when npm reports no latest version", () => {
    expect(
      createStatsSocialCopy(createStats({ latestVersion: null })).detail
    ).toBe("45.2K downloads  ·  12 versions");
  });

  it("omits the version segment before anything is published", () => {
    expect(
      createStatsSocialCopy(
        createStats({ latestVersion: null, versionCount: 0 })
      ).detail
    ).toBe("45.2K downloads");
  });

  it("singularizes a lone published version", () => {
    expect(
      createStatsSocialCopy(
        createStats({ latestVersion: "0.1.0", versionCount: 1 })
      ).detail
    ).toBe("45.2K downloads  ·  1 version  ·  v0.1.0 latest");
  });

  it("compacts large download counts", () => {
    expect(
      createStatsSocialCopy(createStats({ totalDownloads: 1_240_000 })).detail
    ).toContain("1.2M downloads");
  });

  it("leaves small download counts uncompacted", () => {
    expect(
      createStatsSocialCopy(createStats({ totalDownloads: 842 })).detail
    ).toContain("842 downloads");
  });
});
