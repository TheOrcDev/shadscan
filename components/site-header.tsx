"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShadscanMark } from "@/components/shadscan-mark";
import { ThemeSwitcherControl } from "@/components/theme-switcher-control";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/scan", label: "Scan" },
] as const;

const isActivePath = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

function SiteHeader() {
  const pathname = usePathname();

  return (
    <header>
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          aria-current={pathname === "/" ? "page" : undefined}
          className="flex items-center gap-2 font-heading font-medium"
          href="/"
        >
          <ShadscanMark className="size-7" />
          <span>shadscan</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {NAV_LINKS.map((link) => {
            const isActive = isActivePath(pathname, link.href);

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  buttonVariants({ size: "sm", variant: "ghost" }),
                  isActive && "bg-muted text-foreground"
                )}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            );
          })}
          <ThemeSwitcherControl />
        </div>
      </div>
    </header>
  );
}

export { SiteHeader };
