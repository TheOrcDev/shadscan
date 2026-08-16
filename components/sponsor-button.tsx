"use client";

import { HeartIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A heart on its own does not say "sponsor", so the tooltip carries the label
 * for pointer users and the sr-only text carries it for everyone else.
 */
function SponsorButton() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild className="size-8 px-0" variant="ghost">
            <Link href="/sponsors">
              <HeartIcon weight="fill" />
              <span className="sr-only">Sponsor shadscan</span>
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Sponsor shadscan</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { SponsorButton };
