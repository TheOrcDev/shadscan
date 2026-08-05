import {
  DailyDownloadsChart,
  VersionDownloadsChart,
} from "@/components/stats-charts";
import { Separator } from "@/components/ui/separator";
import { getNpmStats, PACKAGE_NAME } from "@/lib/npm-stats";
import { getHeaderGitHubRepository } from "@/lib/public-github-repository";
import { createPageMetadata } from "@/lib/site-metadata";

export const revalidate = 3600;

export const metadata = createPageMetadata({
  description:
    "npm downloads, version adoption, and repository stats for the shadscan CLI.",
  imageAlt: "shadscan usage stats: npm downloads and version adoption",
  imagePath: "/stats/opengraph-image",
  path: "/stats",
  title: "Shadscan usage stats",
});

const COMPACT = new Intl.NumberFormat("en-US", {
  compactDisplay: "short",
  maximumFractionDigits: 1,
  notation: "compact",
});
const EXACT = new Intl.NumberFormat("en-US");
const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

interface StatTileProps {
  detail?: string;
  label: string;
  title?: string;
  value: string;
}

function StatTile({ detail, label, title, value }: StatTileProps) {
  return (
    <div className="flex flex-col gap-1 rounded-none border border-border p-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd
        className="font-heading font-semibold text-2xl tabular-nums"
        title={title}
      >
        {value}
      </dd>
      {detail ? (
        <p className="text-muted-foreground text-xs">{detail}</p>
      ) : null}
    </div>
  );
}

function StatsUnavailable() {
  return (
    <p className="rounded-none border border-border border-dashed p-6 text-muted-foreground text-sm">
      Download stats are temporarily unavailable. The npm registry did not
      answer; this page will fill back in on its next refresh.
    </p>
  );
}

export default async function StatsPage() {
  const [stats, repository] = await Promise.all([
    getNpmStats(),
    // The always-available accessor: it falls back to the canonical repo when
    // SHADSCAN_PUBLIC_GITHUB_REPOSITORY is unset, which is what the header uses.
    getHeaderGitHubRepository(),
  ]);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-3">
        <h1 className="font-heading font-semibold text-3xl tracking-tight">
          Stats
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Public usage numbers for{" "}
          <code className="rounded-none bg-muted px-1.5 py-0.5 text-sm">
            {PACKAGE_NAME}
          </code>
          , pulled from the npm registry. Counts include continuous integration
          and mirrors, so they measure downloads rather than people.
        </p>
      </header>

      <Separator className="my-8" />

      {stats === null ? (
        <StatsUnavailable />
      ) : (
        <div className="flex flex-col gap-12">
          <section className="flex flex-col gap-4">
            <h2 className="sr-only">Summary</h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile
                detail={`since ${DAY_FORMAT.format(new Date(`${stats.firstPublishedDay}T00:00:00Z`))}`}
                label="Downloads"
                title={EXACT.format(stats.totalDownloads)}
                value={COMPACT.format(stats.totalDownloads)}
              />
              <StatTile
                detail="last 7 days"
                label="Recent"
                title={
                  stats.lastWeekDownloads === null
                    ? undefined
                    : EXACT.format(stats.lastWeekDownloads)
                }
                value={
                  stats.lastWeekDownloads === null
                    ? "—"
                    : COMPACT.format(stats.lastWeekDownloads)
                }
              />
              <StatTile label="Latest" value={stats.latestVersion ?? "—"} />
              <StatTile
                detail="published"
                label="Versions"
                value={EXACT.format(stats.versionCount)}
              />
              <StatTile
                label="Stars"
                title={EXACT.format(repository.stargazersCount)}
                value={COMPACT.format(repository.stargazersCount)}
              />
            </dl>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-heading font-semibold text-xl tracking-tight">
                Downloads per day
              </h2>
              <p className="text-muted-foreground text-sm">
                Every settled day since the first release. npm fills a
                day&apos;s total in some hours after it closes, so the most
                recent day or two arrive late rather than at zero.
              </p>
            </div>
            {stats.daily.length > 0 ? (
              <DailyDownloadsChart data={stats.daily} />
            ) : (
              <StatsUnavailable />
            )}
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-heading font-semibold text-xl tracking-tight">
                Which versions people run
              </h2>
              <p className="text-muted-foreground text-sm">
                A snapshot of the last 7 days, not a trend — npm publishes no
                per-version history. Prereleases and older versions are grouped
                as “other”.
              </p>
            </div>
            {stats.versions.length > 0 ? (
              <>
                <VersionDownloadsChart data={stats.versions} />
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Downloads per version over the last 7 days
                  </caption>
                  <thead>
                    <tr className="border-border border-b text-muted-foreground">
                      <th className="py-2 text-left font-medium" scope="col">
                        Version
                      </th>
                      <th className="py-2 text-right font-medium" scope="col">
                        Downloads
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.versions.map((entry) => (
                      <tr
                        className="border-border/60 border-b"
                        key={entry.version}
                      >
                        <th
                          className="py-2 text-left font-normal tabular-nums"
                          scope="row"
                        >
                          {entry.version}
                        </th>
                        <td className="py-2 text-right tabular-nums">
                          {EXACT.format(entry.downloads)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <StatsUnavailable />
            )}
          </section>
        </div>
      )}
    </main>
  );
}
