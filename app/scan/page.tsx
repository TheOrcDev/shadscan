import type { Metadata } from "next";
import Link from "next/link";
import { ShadscanMark } from "@/components/shadscan-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { RepositoryScanner } from "./repository-scanner";

export const runtime = "nodejs";
export const maxDuration = 30;

export const metadata: Metadata = {
  alternates: { canonical: "/scan" },
  description: "Scan a public GitHub repository with Shadscan.",
  openGraph: {
    description: "Scan a public GitHub repository with Shadscan.",
    title: "Scan a GitHub repository",
    url: "/scan",
  },
  title: "Scan a GitHub repository",
};

export default function ScanPage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-border border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            className="flex items-center gap-2 font-heading font-medium"
            href="/"
          >
            <ShadscanMark className="size-7" />
            <span>Shadscan</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="font-heading font-medium text-3xl">
          Scan a GitHub repository
        </h1>
        <RepositoryScanner />
      </main>
    </div>
  );
}
