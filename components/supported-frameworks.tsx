"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FRAMEWORK_MARKS } from "@/lib/framework-marks";
import { cn } from "@/lib/utils";

interface SupportedFrameworksProps {
  className?: string;
}

function SupportedFrameworks({ className }: SupportedFrameworksProps) {
  return (
    <TooltipProvider>
      <div className={cn("flex flex-col items-center gap-3", className)}>
        <span className="font-mono text-muted-foreground text-xs uppercase tracking-wide">
          Supporting
        </span>
        <ul className="flex items-center gap-4">
          {FRAMEWORK_MARKS.map((mark) => (
            <li className="flex items-center" key={mark.label}>
              <Tooltip>
                {/* A button keeps the mark reachable by keyboard, so the name
                    is available on focus as well as hover. */}
                <TooltipTrigger className="flex cursor-default items-center rounded-none text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4">
                  <svg
                    aria-hidden="true"
                    className="h-5 w-auto"
                    fill="currentColor"
                    viewBox={mark.viewBox}
                  >
                    <path d={mark.d} />
                  </svg>
                  <span className="sr-only">{mark.label}</span>
                </TooltipTrigger>
                <TooltipContent>{mark.label}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      </div>
    </TooltipProvider>
  );
}

export { SupportedFrameworks };
