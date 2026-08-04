import type { NpmStats } from "@/lib/npm-stats";

interface StatsSocialCopy {
  detail: string;
  footer: string;
  headline: string;
}

const COMPACT_DOWNLOADS = new Intl.NumberFormat("en-US", {
  compactDisplay: "short",
  maximumFractionDigits: 1,
  notation: "compact",
});

const HEADLINE = "shadscan by the numbers.";
// The page is explicit that these counts include CI and mirrors, so the card
// says "downloads" rather than implying a headcount.
const FALLBACK_DETAIL =
  "npm downloads, version adoption, and repository stats.";
const FOOTER = "Public npm numbers, refreshed hourly.";
const SEGMENT_SEPARATOR = "  ·  ";

/**
 * Social card copy for /stats. Falls back to a static description whenever npm
 * has not answered, so the card renders even when the page cannot show numbers.
 */
const createStatsSocialCopy = (stats: NpmStats | null): StatsSocialCopy => {
  if (stats === null) {
    return { detail: FALLBACK_DETAIL, footer: FOOTER, headline: HEADLINE };
  }

  const segments = [
    `${COMPACT_DOWNLOADS.format(stats.totalDownloads)} downloads`,
  ];

  if (stats.versionCount > 0) {
    const versionNoun = stats.versionCount === 1 ? "version" : "versions";
    segments.push(`${stats.versionCount} ${versionNoun}`);
  }

  if (stats.latestVersion !== null) {
    segments.push(`v${stats.latestVersion} latest`);
  }

  return {
    detail: segments.join(SEGMENT_SEPARATOR),
    footer: FOOTER,
    headline: HEADLINE,
  };
};

export type { StatsSocialCopy };
export { createStatsSocialCopy };
