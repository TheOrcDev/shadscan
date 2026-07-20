"use client";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid flex-1 place-items-center px-5">
      <div className="w-full max-w-md border bg-card p-6">
        <p className="font-mono text-destructive text-sm">Error</p>
        <h1 className="mt-3 font-heading font-medium text-3xl">
          Audit interrupted
        </h1>
        <p className="mt-3 text-muted-foreground leading-7">
          The app hit an unexpected state. Try the audit again.
        </p>
        <Button className="mt-5" onClick={reset} type="button">
          Try again
        </Button>
      </div>
    </main>
  );
}
