import { GetStarted } from "@/components/get-started";
import { Hero } from "@/components/hero";
import { ShadscanMark } from "@/components/shadscan-mark";
import { SiteStructuredData } from "@/components/site-structured-data";
import { getConfiguredGitHubRepository } from "@/lib/public-github-repository";

export default function Page() {
  // Falls back to the canonical repo until SHADSCAN_PUBLIC_GITHUB_REPOSITORY is
  // configured (the repo goes public on release).
  const repository = getConfiguredGitHubRepository() ?? "TheOrcDev/shadscan";

  return (
    <>
      <SiteStructuredData />
      <main className="flex-1 bg-background">
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
            <ShadscanMark
              accessibleTitle="shadscan"
              className="size-16 text-foreground"
            />
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
