"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Toggle theme"
            onClick={() => {
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <MoonIcon aria-hidden="true" className="dark:hidden" />
            <SunIcon aria-hidden="true" className="hidden dark:block" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Toggle theme</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { ThemeToggle };
