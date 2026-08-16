import { HeartIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Sized to sit alongside GitHubStars rather than the icon-only theme toggle,
 * since the label is visible. That label is also the accessible name, so no
 * tooltip or sr-only text is needed to explain the heart.
 */
function SponsorButton() {
  return (
    <Button asChild className="gap-1.5 px-2" size="sm" variant="ghost">
      <Link href="/sponsors">
        <HeartIcon weight="fill" />
        <span className="text-[0.8125rem]/none text-muted-foreground normal-case tracking-normal">
          Sponsor
        </span>
      </Link>
    </Button>
  );
}

export { SponsorButton };
