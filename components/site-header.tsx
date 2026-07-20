import Link from "next/link";
import { ShadscanMark } from "@/components/shadscan-mark";
import { ThemeSwitcherControl } from "@/components/theme-switcher-control";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function SiteHeader() {
  return (
    <header>
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          className="flex items-center gap-2 font-heading font-medium"
          href="/"
        >
          <ShadscanMark className="size-7" />
          <span>shadscan</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
            href="/scan"
          >
            Scan
          </Link>
          <ThemeSwitcherControl />
        </div>
      </div>
    </header>
  );
}

export { SiteHeader };
