"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useCallback } from "react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { toggleThemeWithTransition } from "@/lib/theme-toggle";

function ModeSwitcher() {
  const { setTheme, resolvedTheme } = useTheme();

  const toggleTheme = useCallback(() => {
    toggleThemeWithTransition({ resolvedTheme, setTheme });
  }, [resolvedTheme, setTheme]);

  return (
    <Button
      className="group/toggle size-8 px-0"
      onClick={toggleTheme}
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
