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
        <h1 className="font-heading font-medium text-3xl">
          Scan a GitHub repository
        </h1>
        <RepositoryScanner />
      </main>
    </div>
  );
}
