import Link from "next/link";

function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-center sm:flex-row sm:px-6 sm:text-left">
        <p className="text-muted-foreground text-sm">
          Made by{" "}
          <a
            className="underline underline-offset-4"
            href="https://orcdev.com"
            rel="noopener noreferrer"
            target="_blank"
          >
            OrcDev
          </a>{" "}
          with <span aria-hidden="true">🪓</span>
        </p>
        <nav aria-label="Secondary" className="flex items-center gap-4 text-sm">
          <Link
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/stats"
          >
            Stats
          </Link>
          <Link
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/contributors"
          >
            Contributors
          </Link>
          <Link
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/privacy"
          >
            Privacy
          </Link>
          <Link
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/terms"
          >
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export { SiteFooter };
