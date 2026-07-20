import type { Metadata } from "next";
import { RepositoryScanner } from "./repository-scanner";

export const runtime = "nodejs";
export const maxDuration = 30;

export const metadata: Metadata = {
  alternates: { canonical: "/scan" },
  description: "Scan a public GitHub repository with shadscan.",
  openGraph: {
    description: "Scan a public GitHub repository with shadscan.",
    title: "Scan a GitHub repository",
    url: "/scan",
  },
  title: "Scan a GitHub repository",
};

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
