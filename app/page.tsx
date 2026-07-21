import { GetStarted } from "@/components/get-started";
import { Hero } from "@/components/hero";
import { ShadscanMark } from "@/components/shadscan-mark";
import { SiteStructuredData } from "@/components/site-structured-data";

export default function Page() {
  return (
    <>
      <SiteStructuredData />
      <main className="flex-1 bg-background">
        <Hero
          buttons={{
            primary: { text: "Scan a repository", url: "/scan" },
            secondary: { text: "Read the docs", url: "/docs" },
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
