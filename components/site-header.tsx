"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandAssetsMenu } from "@/components/brand-assets-menu";
import { CommandMenu } from "@/components/command-menu";
import { GitHubStars } from "@/components/github-stars";
import { ModeSwitcher } from "@/components/mode-switcher";
import { ShadscanMark } from "@/components/shadscan-mark";
import { SponsorButton } from "@/components/sponsor-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/scan", label: "Scan" },
  { href: "/sponsors", label: "Sponsors" },
] as const;

interface SiteHeaderProps {
  githubRepository: {
    name: string;
    stargazersCount: number;
  };
}

const isActivePath = (pathname: string | null, href: string): boolean =>
  pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));

function SiteHeader({ githubRepository }: SiteHeaderProps) {
  const pathname = usePathname();

  return (
    <header>
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <BrandAssetsMenu brandAssetsUrl="/brand/shadscan-brand-assets.zip">
            <Link
              aria-current={pathname === "/" ? "page" : undefined}
              className="flex items-center gap-2 font-heading font-medium"
              href="/"
            >
              <ShadscanMark className="size-7" />
              <span className="hidden sm:inline">shadscan</span>
            </Link>
          </BrandAssetsMenu>
          <nav aria-label="Primary" className="flex items-center gap-1">
            {NAV_LINKS.map((link) => {
              const isActive = isActivePath(pathname, link.href);

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    buttonVariants({ size: "sm", variant: "ghost" }),
                    "px-2 sm:px-4",
                    isActive && "bg-muted text-foreground"
                  )}
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <CommandMenu
            repositoryUrl={`https://github.com/${githubRepository.name}`}
          />
          <div className="hidden lg:block">
            <GitHubStars
              repo={githubRepository.name}
              stargazersCount={githubRepository.stargazersCount}
            />
          </div>
          {/* The stars and this button only appear at lg. The nav and the
              search trigger do not shrink, so revealing them any earlier
              overlaps the nav across the whole 640-785px band — the header
              needs 768px to fit them, and sm starts at 640px. Both remain
              reachable: /sponsors from the nav link, the repo from the
              command menu. */}
          <div className="hidden lg:block">
            <SponsorButton />
          </div>
          <ModeSwitcher />
        </div>
      </div>
    </header>
  );
}

export { SiteHeader };
