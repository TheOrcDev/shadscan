import Link from "next/link";
import { createPageMetadata } from "@/lib/site-metadata";
import { RepositoryScanner } from "./repository-scanner";

export const runtime = "nodejs";
export const maxDuration = 30;

export const metadata = createPageMetadata({
  description:
    "Paste a public GitHub repository to get a deterministic Shadscan score, cited evidence, and actionable fixes.",
  imageAlt: "Scan a public shadcn repository with shadscan",
  imagePath: "/scan/opengraph-image",
  path: "/scan",
  title: "Scan a shadcn app",
});

export default function ScanPage() {
  return (
    <div className="flex-1 bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
        <header className="flex flex-col gap-4">
          <h1 className="font-heading font-medium text-3xl">
            Scan a GitHub repository
          </h1>
          <div className="flex max-w-3xl flex-col gap-3 text-muted-foreground">
            <p>
              A quick, no-install taste of Shadscan: paste a public GitHub
              repository and get the same deterministic score, evidence, and
              fixes the CLI produces. Web scans reach public repositories only
              and cap out at roughly 32 MiB of source and 10,000 files — larger
              scans are queued and can take a while or fail.
            </p>
            <p>
              For real work, run the CLI instead. It scans private code locally
              without uploading anything, has no web size ceiling, runs in CI
              with <code className="whitespace-nowrap">--fail-under</code>, and
              works best with AI agents: generate a remediation handoff with{" "}
              <code className="whitespace-nowrap">--prompt</code>, let your
              agent fix the findings, and rescan to verify. The{" "}
              <Link className="underline underline-offset-4" href="/docs">
                docs
              </Link>{" "}
              cover the full agent workflow.
            </p>
          </div>
        </header>
        <RepositoryScanner />
      </main>
    </div>
  );
}
