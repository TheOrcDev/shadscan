import { unstable_cache } from "next/cache";

const NPM_DOWNLOADS_ORIGIN = "https://api.npmjs.org";
const NPM_REGISTRY_ORIGIN = "https://registry.npmjs.org";
const PACKAGE_NAME = "@shadscan/cli";
const REVALIDATE_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 5000;
/** npm serves at most 18 months of daily history in one range request. */
const MAX_RANGE_DAYS = 540;
const DAY_MS = 86_400_000;
const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRERELEASE_PATTERN = /-/;
/** Versions charted individually before the remainder is grouped. */
const TOP_VERSION_COUNT = 6;

interface DownloadDay {
  day: string;
  downloads: number;
}

interface VersionDownloads {
  downloads: number;
  isPrerelease: boolean;
  version: string;
}

interface ReleaseMarker {
  day: string;
  version: string;
}

interface NpmStats {
  /** Daily downloads from the first publish date to the most recent full day. */
  daily: DownloadDay[];
  firstPublishedDay: string;
  lastWeekDownloads: number | null;
  latestVersion: string | null;
  releases: ReleaseMarker[];
  totalDownloads: number;
  versionCount: number;
  versions: VersionDownloads[];
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

const REQUEST_INIT: RequestInit = {
  headers: { Accept: "application/json", "User-Agent": "shadscan" },
  redirect: "error",
};

const toIsoDay = (value: Date): string =>
  value.toISOString().slice(0, 10) as string;

/**
 * npm publishes a day's totals some hours after it closes, so the current day
 * is always partial and would render as a cliff at the right edge of the
 * chart. Reporting through yesterday keeps every plotted point final.
 */
const getLastCompleteDay = (now: Date): string =>
  toIsoDay(new Date(now.getTime() - DAY_MS));

const isIsoDay = (value: unknown): value is string =>
  typeof value === "string" && ISO_DAY_PATTERN.test(value);

const isDownloadCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Every fetch degrades to null so an npm outage cannot take the page down. */
const fetchJson = async (
  url: string,
  fetchImplementation: FetchImplementation
): Promise<unknown> => {
  try {
    const response = await fetchImplementation(url, {
      ...REQUEST_INIT,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
};

/**
 * The scope separator must be percent-encoded for the per-version endpoint,
 * which rejects a bare slash. The downloads endpoints accept it either way,
 * so encoding everywhere keeps one rule rather than two.
 */
const encodePackageName = (packageName: string): string =>
  packageName.replace("/", "%2F");

const clampRangeStart = (firstPublishedDay: string, endDay: string): string => {
  const earliest =
    new Date(`${endDay}T00:00:00Z`).getTime() - MAX_RANGE_DAYS * DAY_MS;

  return new Date(`${firstPublishedDay}T00:00:00Z`).getTime() < earliest
    ? toIsoDay(new Date(earliest))
    : firstPublishedDay;
};

interface RegistryMetadata {
  firstPublishedDay: string;
  latestVersion: string | null;
  releases: ReleaseMarker[];
  versionCount: number;
}

/**
 * The registry `time` map is the only source for when a version shipped, so
 * release markers and the chart's start date both come from here rather than
 * from a constant that would rot.
 */
const parseRegistryMetadata = (payload: unknown): RegistryMetadata | null => {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const { "dist-tags": distTags, time } = payload as Record<string, unknown>;

  if (typeof time !== "object" || time === null) {
    return null;
  }

  const entries = Object.entries(time as Record<string, unknown>).filter(
    ([key, value]) =>
      key !== "created" && key !== "modified" && typeof value === "string"
  );
  const created = (time as Record<string, unknown>).created;

  if (typeof created !== "string" || entries.length === 0) {
    return null;
  }

  const releases = entries
    .filter(([version]) => !PRERELEASE_PATTERN.test(version))
    .map(([version, published]) => ({
      day: String(published).slice(0, 10),
      version,
    }))
    .filter((release) => isIsoDay(release.day))
    .sort(
      (left, right) =>
        left.day.localeCompare(right.day) ||
        left.version.localeCompare(right.version)
    );

  const latestVersion =
    typeof distTags === "object" && distTags !== null
      ? ((distTags as Record<string, unknown>).latest ?? null)
      : null;

  return {
    firstPublishedDay: created.slice(0, 10),
    latestVersion: typeof latestVersion === "string" ? latestVersion : null,
    releases,
    versionCount: entries.length,
  };
};

const parseDownloadRange = (payload: unknown): DownloadDay[] | null => {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const { downloads } = payload as Record<string, unknown>;

  if (!Array.isArray(downloads)) {
    return null;
  }

  const days: DownloadDay[] = [];
  for (const entry of downloads) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }

    const { day, downloads: count } = entry as Record<string, unknown>;
    if (!(isIsoDay(day) && isDownloadCount(count))) {
      return null;
    }

    days.push({ day, downloads: count });
  }

  return days;
};

const parseVersionDownloads = (payload: unknown): VersionDownloads[] | null => {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const { downloads } = payload as Record<string, unknown>;

  if (typeof downloads !== "object" || downloads === null) {
    return null;
  }

  const versions: VersionDownloads[] = [];
  for (const [version, count] of Object.entries(
    downloads as Record<string, unknown>
  )) {
    if (!isDownloadCount(count)) {
      return null;
    }

    if (count > 0) {
      versions.push({
        downloads: count,
        isPrerelease: PRERELEASE_PATTERN.test(version),
        version,
      });
    }
  }

  return versions.sort(
    (left, right) =>
      right.downloads - left.downloads ||
      left.version.localeCompare(right.version)
  );
};

const parseLastWeekDownloads = (payload: unknown): number | null => {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const { downloads } = payload as Record<string, unknown>;

  return isDownloadCount(downloads) ? downloads : null;
};

/**
 * Prereleases and the long tail are folded into one bar so the chart shows
 * which stable versions people actually run without a dozen slivers.
 */
const summarizeVersions = (
  versions: VersionDownloads[]
): VersionDownloads[] => {
  const stable = versions.filter((entry) => !entry.isPrerelease);
  const rest = versions.filter((entry) => entry.isPrerelease);
  const top = stable.slice(0, TOP_VERSION_COUNT);
  const remainder = [...stable.slice(TOP_VERSION_COUNT), ...rest];
  const remainderTotal = remainder.reduce(
    (total, entry) => total + entry.downloads,
    0
  );

  return remainderTotal > 0
    ? [
        ...top,
        { downloads: remainderTotal, isPrerelease: false, version: "other" },
      ]
    : top;
};

const fetchNpmStats = async (
  now: number,
  fetchImplementation: FetchImplementation = fetch
): Promise<NpmStats | null> => {
  const encodedName = encodePackageName(PACKAGE_NAME);
  const registry = parseRegistryMetadata(
    await fetchJson(
      `${NPM_REGISTRY_ORIGIN}/${encodedName}`,
      fetchImplementation
    )
  );

  if (registry === null) {
    return null;
  }

  const endDay = getLastCompleteDay(new Date(now));
  const startDay = clampRangeStart(registry.firstPublishedDay, endDay);
  const [rangePayload, versionsPayload, lastWeekPayload] = await Promise.all([
    fetchJson(
      `${NPM_DOWNLOADS_ORIGIN}/downloads/range/${startDay}:${endDay}/${encodedName}`,
      fetchImplementation
    ),
    fetchJson(
      `${NPM_DOWNLOADS_ORIGIN}/versions/${encodedName}/last-week`,
      fetchImplementation
    ),
    fetchJson(
      `${NPM_DOWNLOADS_ORIGIN}/downloads/point/last-week/${encodedName}`,
      fetchImplementation
    ),
  ]);

  const daily = parseDownloadRange(rangePayload) ?? [];
  const versions = parseVersionDownloads(versionsPayload) ?? [];

  return {
    daily,
    firstPublishedDay: registry.firstPublishedDay,
    lastWeekDownloads: parseLastWeekDownloads(lastWeekPayload),
    latestVersion: registry.latestVersion,
    releases: registry.releases.filter((release) => release.day >= startDay),
    totalDownloads: daily.reduce((total, entry) => total + entry.downloads, 0),
    versionCount: registry.versionCount,
    versions: summarizeVersions(versions),
  };
};

const getCachedNpmStats = unstable_cache(fetchNpmStats, ["npm-stats"], {
  revalidate: REVALIDATE_SECONDS,
});

/**
 * The cache key is bucketed by hour so `unstable_cache` does not treat every
 * millisecond as a distinct argument and defeat its own revalidation.
 */
const getNpmStats = (): Promise<NpmStats | null> =>
  getCachedNpmStats(
    Math.floor(Date.now() / (REVALIDATE_SECONDS * 1000)) *
      REVALIDATE_SECONDS *
      1000
  );

export type { DownloadDay, NpmStats, ReleaseMarker, VersionDownloads };
export {
  clampRangeStart,
  encodePackageName,
  fetchNpmStats,
  getLastCompleteDay,
  getNpmStats,
  PACKAGE_NAME,
  parseDownloadRange,
  parseRegistryMetadata,
  parseVersionDownloads,
  summarizeVersions,
};
