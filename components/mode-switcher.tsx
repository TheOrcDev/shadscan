"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { toggleTheme } from "@/lib/theme-toggle";

function ModeSwitcher() {
  const { setTheme, resolvedTheme } = useTheme();

  return (
    <Button
      className="group/toggle size-8 px-0"
      onClick={() => {
        toggleTheme({ resolvedTheme, setTheme });
      }}
      type="button"
      variant="ghost"
    >
      <SunIcon className="hidden [html.dark_&]:block" />
      <MoonIcon className="hidden [html.light_&]:block" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}

export { ModeSwitcher };
