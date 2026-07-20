const linkClassName =
  "font-medium text-foreground underline-offset-4 hover:underline";

function ExternalLink({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  return (
    <a
      className={linkClassName}
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function SiteFooter() {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-1 px-4 py-6 text-center sm:px-6">
        <p className="text-muted-foreground text-sm">
          Made by <ExternalLink href="https://orcdev.com">OrcDev</ExternalLink>{" "}
          <span aria-hidden="true">🪓</span>
        </p>
        <p className="max-w-2xl text-muted-foreground text-sm">
          OrcDev is the creator of{" "}
          <ExternalLink href="https://agentpacks.ai">Agent Packs</ExternalLink>,{" "}
          <ExternalLink href="https://8bitcn.com">8bitcn</ExternalLink>, and{" "}
          <ExternalLink href="https://videorc.com">Videorc</ExternalLink>.
        </p>
      </div>
    </footer>
  );
}

export { SiteFooter };
