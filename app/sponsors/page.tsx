import { ShadscanMark } from "@/components/shadscan-mark";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { createPageMetadata } from "@/lib/site-metadata";
import {
  SPONSOR_CONTACT_EMAIL,
  SPONSOR_TIERS,
  type SponsorTier,
} from "@/lib/sponsors";
import { cn } from "@/lib/utils";

export const metadata = createPageMetadata({
  description:
    "Support deterministic, open-source UI auditing for React and shadcn applications.",
  imageAlt: "Sponsor deterministic UI audits with shadscan",
  imagePath: "/sponsors/opengraph-image",
  path: "/sponsors",
  title: "Sponsor shadscan",
});

interface SponsorSectionProps {
  tier: SponsorTier;
}

function SponsorSection({ tier }: SponsorSectionProps) {
  return (
    <section aria-label={`${tier.name} sponsors`}>
      <div className="flex flex-col gap-3">
        <h2 className="font-mono font-semibold text-muted-foreground text-xs uppercase">
          {tier.name}
        </h2>
        <Separator />
      </div>
      <ul className={cn("grid gap-3 pt-4", tier.gridClassName)}>
        {tier.slotIds.map((slotId, index) => (
          <li className="flex" key={slotId}>
            <Button
              asChild
              className={cn(
                "h-auto w-full border-dashed px-2 text-muted-foreground hover:border-foreground/40",
                tier.slotClassName
              )}
              variant="outline"
            >
              <a
                aria-label={`Sponsor shadscan at the ${tier.name} tier, slot ${index + 1}`}
                href={tier.checkoutHref}
              >
                Be here
              </a>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SponsorsPage() {
  return (
    <main className="flex-1 overflow-x-clip bg-background text-foreground">
      <div className="mx-auto w-full max-w-4xl px-4 pt-12 pb-24 sm:px-6 sm:pt-16">
        <header className="flex flex-col items-center gap-4 pb-12 text-center">
          <ShadscanMark
            accessibleTitle="shadscan"
            className="size-16 text-foreground"
          />
          <h1 className="font-heading font-medium text-4xl">
            Sponsor shadscan
          </h1>
          <p className="max-w-xl text-balance text-muted-foreground">
            Keep deterministic open-source UI audits shipping. Every tier puts
            your logo and name on this page, links to your site, and includes
            you in major release notes.
          </p>
        </header>

        <div className="flex flex-col gap-12">
          {SPONSOR_TIERS.map((tier) => (
            <SponsorSection key={tier.id} tier={tier} />
          ))}
        </div>

        <p className="pt-14 text-center text-muted-foreground text-sm">
          Questions, invoices, or a custom arrangement?{" "}
          <a
            className="underline underline-offset-4 hover:text-foreground"
            href={`mailto:${SPONSOR_CONTACT_EMAIL}`}
          >
            {SPONSOR_CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </main>
  );
}
