import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { GetStarted } from "@/components/get-started";
import { Hero } from "@/components/hero";
import { SiteStructuredData } from "@/components/site-structured-data";
import { Badge } from "@/components/ui/badge";
import { getChangelogReleases } from "@/lib/changelog";
import {
  getConfiguredGitHubRepository,
  SOURCE_CODE_GITHUB_REPOSITORY,
} from "@/lib/public-github-repository";

export default async function Page() {
  // Falls back to the canonical repo until SHADSCAN_PUBLIC_GITHUB_REPOSITORY is
  // configured (the repo goes public on release).
  const repository =
    getConfiguredGitHubRepository() ?? SOURCE_CODE_GITHUB_REPOSITORY;
  const releases = await getChangelogReleases();
  const latestRelease = releases[0];

  return (
    <>
      <SiteStructuredData />
      <main className="flex flex-1 flex-col justify-center bg-background">
        <Hero
          buttons={{
            primary: { text: "Get started", url: "/docs" },
            secondary: {
              text: "GitHub",
              url: `https://github.com/${repository}`,
            },
          }}
          description="shadscan statically analyzes your React shadcn components for accessibility, state, and composition regressions — the same result on every run, built for your terminal and your CI."
          heading="Deterministic UI audits for shadcn apps"
          logo={
            <Badge
              asChild
              className="h-5 border border-border bg-secondary px-2.5 text-secondary-foreground hover:bg-secondary/80 has-data-[icon=inline-end]:pr-2.5"
              variant="secondary"
            >
              <Link href="/changelog">
                {latestRelease ? (
                  <>
                    <span>v{latestRelease.version}</span>
                    <span aria-hidden="true">·</span>
                  </>
                ) : null}
                <span>Changelog</span>
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Badge>
          }
          media={
            <div className="mx-auto w-full max-w-xl">
              <GetStarted />
            </div>
          }
        />
      </main>
    </>
  );
}
