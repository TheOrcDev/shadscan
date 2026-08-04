import { describe, expect, it } from "vitest";
import {
  clampRangeStart,
  encodePackageName,
  fetchNpmStats,
  getLastCompleteDay,
  PACKAGE_NAME,
  parseDownloadRange,
  parseRegistryMetadata,
  parseVersionDownloads,
  summarizeVersions,
} from "../../lib/npm-stats";

const REGISTRY_PAYLOAD = {
  "dist-tags": { latest: "0.8.0", next: "0.1.0-rc.7" },
  time: {
    created: "2026-07-22T10:00:00.000Z",
    modified: "2026-07-30T16:00:00.000Z",
    "0.1.0-rc.7": "2026-07-22T12:00:00.000Z",
    "0.7.0": "2026-07-27T09:00:00.000Z",
    "0.8.0": "2026-07-30T16:00:00.000Z",
  },
};

const RANGE_PAYLOAD = {
  downloads: [
    { day: "2026-07-27", downloads: 1076 },
    { day: "2026-07-28", downloads: 975 },
    { day: "2026-07-29", downloads: 2558 },
  ],
  end: "2026-07-29",
  package: PACKAGE_NAME,
  start: "2026-07-27",
};

const NOW = Date.parse("2026-07-30T12:00:00.000Z");

const createFetch = (
  routes: Record<string, unknown>,
  status: Record<string, number> = {}
) => {
  const calls: string[] = [];
  const fetchImplementation = (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((route) => url.includes(route));

    if (key === undefined) {
      return Promise.resolve(
        new Response("not found", { status: 404 }) as Response
      );
    }

    const statusKey = Object.keys(status).find((route) => url.includes(route));

    return Promise.resolve(
      new Response(JSON.stringify(routes[key]), {
        headers: { "content-type": "application/json" },
        status: statusKey === undefined ? 200 : status[statusKey],
      }) as Response
    );
  };

  return { calls, fetchImplementation };
};

const ALL_ROUTES = {
  "/downloads/point/last-week/": { downloads: 9631 },
  "/downloads/range/": RANGE_PAYLOAD,
  "/versions/": {
    downloads: { "0.1.0-rc.7": 72, "0.7.0": 3095, "0.8.0": 2302 },
  },
  "registry.npmjs.org": REGISTRY_PAYLOAD,
};

describe("npm stats helpers", () => {
  it("percent-encodes the scope so the per-version endpoint accepts it", () => {
    expect(encodePackageName("@shadscan/cli")).toBe("@shadscan%2Fcli");
  });

  it("reports through the last complete day rather than a partial today", () => {
    expect(getLastCompleteDay(new Date("2026-07-30T12:00:00.000Z"))).toBe(
      "2026-07-29"
    );
  });

  it("keeps a recent first-publish date and clamps an ancient one", () => {
    expect(clampRangeStart("2026-07-22", "2026-07-30")).toBe("2026-07-22");
    expect(clampRangeStart("2000-01-01", "2026-07-30") > "2024-01-01").toBe(
      true
    );
  });

  it("reads publish dates and stable releases from the registry time map", () => {
    const metadata = parseRegistryMetadata(REGISTRY_PAYLOAD);

    expect(metadata?.firstPublishedDay).toBe("2026-07-22");
    expect(metadata?.latestVersion).toBe("0.8.0");
    expect(metadata?.versionCount).toBe(3);
    // Prereleases are omitted from release markers to keep the chart readable.
    expect(metadata?.releases).toEqual([
      { day: "2026-07-27", version: "0.7.0" },
      { day: "2026-07-30", version: "0.8.0" },
    ]);
  });

  it("rejects payload shapes it does not recognize", () => {
    expect(parseRegistryMetadata(null)).toBeNull();
    expect(parseRegistryMetadata({ time: {} })).toBeNull();
    expect(parseDownloadRange({ downloads: "nope" })).toBeNull();
    expect(
      parseDownloadRange({ downloads: [{ day: "x", downloads: 1 }] })
    ).toBeNull();
    expect(
      parseDownloadRange({ downloads: [{ day: "2026-07-27", downloads: -1 }] })
    ).toBeNull();
    expect(
      parseVersionDownloads({ downloads: { "1.0.0": "many" } })
    ).toBeNull();
  });

  it("orders versions by downloads and flags prereleases", () => {
    const versions = parseVersionDownloads({
      downloads: { "0.1.0-rc.7": 72, "0.7.0": 3095, "0.8.0": 2302 },
    });

    expect(versions?.map((entry) => entry.version)).toEqual([
      "0.7.0",
      "0.8.0",
      "0.1.0-rc.7",
    ]);
    expect(versions?.at(-1)?.isPrerelease).toBe(true);
  });

  it("groups prereleases and the long tail into one other bar", () => {
    const summarized = summarizeVersions([
      { downloads: 100, isPrerelease: false, version: "0.8.0" },
      { downloads: 90, isPrerelease: false, version: "0.7.0" },
      { downloads: 80, isPrerelease: false, version: "0.6.1" },
      { downloads: 70, isPrerelease: false, version: "0.6.0" },
      { downloads: 60, isPrerelease: false, version: "0.5.0" },
      { downloads: 50, isPrerelease: false, version: "0.4.0" },
      { downloads: 40, isPrerelease: false, version: "0.3.0" },
      { downloads: 5, isPrerelease: true, version: "0.1.0-rc.7" },
    ]);

    expect(summarized).toHaveLength(7);
    expect(summarized.at(-1)).toEqual({
      downloads: 45,
      isPrerelease: false,
      version: "other",
    });
  });

  it("omits the other bar when nothing is left over", () => {
    const summarized = summarizeVersions([
      { downloads: 100, isPrerelease: false, version: "0.8.0" },
    ]);

    expect(summarized).toEqual([
      { downloads: 100, isPrerelease: false, version: "0.8.0" },
    ]);
  });
});

describe("fetchNpmStats", () => {
  it("assembles stats from every endpoint", async () => {
    const { calls, fetchImplementation } = createFetch(ALL_ROUTES);
    const stats = await fetchNpmStats(NOW, fetchImplementation);

    expect(stats?.firstPublishedDay).toBe("2026-07-22");
    expect(stats?.latestVersion).toBe("0.8.0");
    expect(stats?.lastWeekDownloads).toBe(9631);
    expect(stats?.totalDownloads).toBe(4609);
    expect(stats?.daily).toHaveLength(3);
    expect(stats?.versions.map((entry) => entry.version)).toEqual([
      "0.7.0",
      "0.8.0",
      "other",
    ]);
    expect(calls.some((url) => url.includes("@shadscan%2Fcli"))).toBe(true);
  });

  it("returns null when the registry is unavailable", async () => {
    const { fetchImplementation } = createFetch(ALL_ROUTES, {
      "registry.npmjs.org": 500,
    });

    expect(await fetchNpmStats(NOW, fetchImplementation)).toBeNull();
  });

  it("degrades to partial stats when only the downloads API fails", async () => {
    const { fetchImplementation } = createFetch(ALL_ROUTES, {
      "/downloads/": 503,
      "/versions/": 503,
    });
    const stats = await fetchNpmStats(NOW, fetchImplementation);

    // The registry answered, so the page still gets versions and release
    // markers rather than an error boundary.
    expect(stats).not.toBeNull();
    expect(stats?.daily).toEqual([]);
    expect(stats?.versions).toEqual([]);
    expect(stats?.totalDownloads).toBe(0);
    expect(stats?.lastWeekDownloads).toBeNull();
    expect(stats?.latestVersion).toBe("0.8.0");
  });

  it("never throws when the network rejects", async () => {
    const stats = await fetchNpmStats(NOW, () =>
      Promise.reject(new Error("offline"))
    );

    expect(stats).toBeNull();
  });
});
