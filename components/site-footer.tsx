function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto flex w-full max-w-6xl items-center justify-center px-4 py-6 text-center sm:px-6">
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
      </div>
    </footer>
  );
}

export { SiteFooter };
