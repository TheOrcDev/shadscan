import { describe, expect, it } from "vitest";
import {
  clampRangeStart,
  encodePackageName,
  fetchNpmStats,
  getLastCompleteDay,
  PACKAGE_NAME,
  parseRegistryMetadata,
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

  it("drops trailing days npm has not settled yet", async () => {
    // npm answers 0 for a day it has not filled in, which is indistinguishable
    // from a real zero and plots as a cliff to the floor at the right edge.
    const { fetchImplementation } = createFetch({
      ...ALL_ROUTES,
      "/downloads/range/": {
        downloads: [
          { day: "2026-07-27", downloads: 1194 },
          { day: "2026-07-28", downloads: 1611 },
          { day: "2026-07-29", downloads: 0 },
          { day: "2026-07-30", downloads: 0 },
        ],
        end: "2026-07-30",
        package: "@shadscan/cli",
        start: "2026-07-27",
      },
    });
    const stats = await fetchNpmStats(NOW, fetchImplementation);

    expect(stats?.daily.map((entry) => entry.day)).toEqual([
      "2026-07-27",
      "2026-07-28",
    ]);
    // The dropped days must not be counted either.
    expect(stats?.totalDownloads).toBe(2805);
  });

  it("keeps an interior zero, which is a real quiet day", async () => {
    const { fetchImplementation } = createFetch({
      ...ALL_ROUTES,
      "/downloads/range/": {
        downloads: [
          { day: "2026-07-27", downloads: 1194 },
          { day: "2026-07-28", downloads: 0 },
          { day: "2026-07-29", downloads: 1611 },
        ],
        end: "2026-07-29",
        package: "@shadscan/cli",
        start: "2026-07-27",
      },
    });
    const stats = await fetchNpmStats(NOW, fetchImplementation);

    expect(stats?.daily).toHaveLength(3);
    expect(stats?.daily[1]?.downloads).toBe(0);
  });

  it("keeps an all-zero series rather than emptying the chart", async () => {
    // A package nobody has downloaded yet still deserves its axis.
    const { fetchImplementation } = createFetch({
      ...ALL_ROUTES,
      "/downloads/range/": {
        downloads: [
          { day: "2026-07-27", downloads: 0 },
          { day: "2026-07-28", downloads: 0 },
        ],
        end: "2026-07-28",
        package: "@shadscan/cli",
        start: "2026-07-27",
      },
    });
    const stats = await fetchNpmStats(NOW, fetchImplementation);

    expect(stats?.daily).toHaveLength(2);
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
    });
    const stats = await fetchNpmStats(NOW, fetchImplementation);

    // The registry answered, so the page still gets the version count and
    // release markers rather than an error boundary.
    expect(stats).not.toBeNull();
    expect(stats?.daily).toEqual([]);
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
