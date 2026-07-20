import { flushSync } from "react-dom";

type ThemeSetter = (theme: string) => void;

interface ToggleThemeParams {
  resolvedTheme?: string;
  setTheme: ThemeSetter;
}

type ViewTransitionStarter = (update: () => void) => void;

type DocumentWithViewTransition = Document & {
  startViewTransition?: ViewTransitionStarter;
};

function getNextTheme(resolvedTheme?: string) {
  return resolvedTheme === "dark" ? "light" : "dark";
}

function toggleThemeWithTransition({
  resolvedTheme,
  setTheme,
}: ToggleThemeParams) {
  const nextTheme = getNextTheme(resolvedTheme);
  const documentWithViewTransition = document as DocumentWithViewTransition;

  if (typeof documentWithViewTransition.startViewTransition !== "function") {
    setTheme(nextTheme);
    return;
  }

  documentWithViewTransition.startViewTransition(() => {
    flushSync(() => {
      setTheme(nextTheme);
    });
  });
}

export { getNextTheme, toggleThemeWithTransition };
