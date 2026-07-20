"use client";

import { useTheme } from "next-themes";
import { ThemeSwitcher } from "@/components/kibo-ui/theme-switcher";

type ThemeValue = "light" | "dark" | "system";

const isThemeValue = (value: string | undefined): value is ThemeValue =>
  value === "light" || value === "dark" || value === "system";

function ThemeSwitcherControl({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <ThemeSwitcher
      className={className}
      defaultValue="system"
      onChange={setTheme}
      value={isThemeValue(theme) ? theme : "system"}
    />
  );
}

export { ThemeSwitcherControl };
