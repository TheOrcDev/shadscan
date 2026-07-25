import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import { ShadscanMark } from "@/components/shadscan-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  type Contributor,
  getContributorStats,
  getContributors,
  resolveContributorsRepository,
} from "@/lib/contributors";
import { createPageMetadata } from "@/lib/site-metadata";

const AVATAR_SIZE_PX = 48;

// Contributors come from the GitHub API, so the page refreshes hourly on its
// own instead of waiting for a redeploy. Segment config must be a literal.
export const revalidate = 3600;

export const metadata = createPageMetadata({
  description:
    "Meet the people who build shadscan, the deterministic UI audit CLI for React and shadcn applications.",
  imageAlt: "The people who build shadscan",
  imagePath: "/contributors/opengraph-image",
  path: "/contributors",
  title: "Shadscan contributors",
});

const numberFormatter = new Intl.NumberFormat("en-US");

interface StatProps {
  label: string;
  value: number;
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="border border-border p-6 text-center">
      <dt className="font-mono font-semibold text-muted-foreground text-xs uppercase">
        {label}
      </dt>
      <dd className="mt-2 font-heading font-medium text-4xl tabular-nums">
        {numberFormatter.format(value)}
      </dd>
    </div>
  );
}

interface ContributorCardProps {
  contributor: Contributor;
  rank: number;
}

function ContributorCard({ contributor, rank }: ContributorCardProps) {
  const { avatarUrl, contributions, login, profileUrl } = contributor;
  const contributionLabel = contributions === 1 ? "commit" : "commits";

  return (
    <a
      className="group flex h-full w-full items-center gap-4 border border-border p-4 transition-colors hover:border-foreground/40 hover:bg-muted/40"
      href={profileUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span className="font-mono text-muted-foreground text-xs tabular-nums">
        {String(rank).padStart(2, "0")}
      </span>
      <Image
        alt=""
        className="shrink-0 border border-border"
        height={AVATAR_SIZE_PX}
        src={avatarUrl}
        // GitHub already serves correctly sized avatars from its own CDN.
        unoptimized
        width={AVATAR_SIZE_PX}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-heading font-medium group-hover:underline group-hover:underline-offset-4">
          {login}
        </span>
        <span>
          <Badge variant="secondary">
            {numberFormatter.format(contributions)} {contributionLabel}
          </Badge>
        </span>
      </span>
      <ArrowSquareOutIcon
        aria-hidden="true"
        className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
      />
      <span className="sr-only">
        {`${login} on GitHub, ${numberFormatter.format(contributions)} ${contributionLabel}`}
      </span>
    </a>
  );
}

export default async function ContributorsPage() {
  const repository = resolveContributorsRepository();
  const contributors = await getContributors();
  const { totalContributions, totalContributors } =
    getContributorStats(contributors);
  const repositoryUrl = `https://github.com/${repository}`;

  return (
    <main className="flex-1 overflow-x-clip bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-4 pt-12 pb-24 sm:px-6 sm:pt-16">
        <header className="flex flex-col items-center gap-4 pb-12 text-center">
          <ShadscanMark
            accessibleTitle="shadscan"
            className="size-16 text-foreground"
          />
          <h1 className="font-heading font-medium text-4xl">Contributors</h1>
          <p className="max-w-xl text-balance text-muted-foreground">
            shadscan is built in the open. Every rule, every fix, and every
            audit it runs exists because someone sent a pull request. These are
            the people behind them.
          </p>
        </header>

        <div className="flex flex-col gap-12">
          {contributors.length > 0 ? (
            <section aria-label="Contribution totals">
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Stat label="Contributors" value={totalContributors} />
                <Stat label="Commits" value={totalContributions} />
              </dl>
            </section>
          ) : null}

          <section aria-label="Contributor list">
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-mono font-semibold text-muted-foreground text-xs uppercase">
                  Everyone who shipped
                </h2>
                <p className="font-mono font-semibold text-foreground text-xs">
                  {repository}
                </p>
              </div>
              <Separator />
            </div>

            {contributors.length > 0 ? (
              <ul className="grid gap-3 pt-4 sm:grid-cols-2">
                {contributors.map((contributor, index) => (
                  <li className="flex min-w-0" key={contributor.login}>
                    <ContributorCard
                      contributor={contributor}
                      rank={index + 1}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 border border-border border-dashed p-8 text-center">
                <p className="text-muted-foreground">
                  The contributor list is unavailable right now. GitHub caches
                  it hourly, so check back soon or open the repository directly.
                </p>
              </div>
            )}
          </section>

          <section aria-label="How to contribute">
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-mono font-semibold text-muted-foreground text-xs uppercase">
                  Join them
                </h2>
                <p className="font-mono font-semibold text-foreground text-xs">
                  Open source
                </p>
              </div>
              <Separator />
            </div>
            <div className="mt-4 border border-border p-8 text-center">
              <p className="mx-auto max-w-md text-muted-foreground">
                Rules are deterministic and every one ships with tests, so a
                first contribution can be as small as a single new check. Pick
                an issue, or open one describing the check you wish shadscan
                ran.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Button asChild>
                  <a
                    href={repositoryUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    View the repository
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a
                    href={`${repositoryUrl}/issues`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Browse open issues
                  </a>
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
