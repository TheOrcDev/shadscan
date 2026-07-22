type ThemeSetter = (theme: string) => void;

interface ToggleThemeParams {
  resolvedTheme?: string;
  setTheme: ThemeSetter;
}

function getNextTheme(resolvedTheme?: string) {
  return resolvedTheme === "dark" ? "light" : "dark";
}

function toggleTheme({ resolvedTheme, setTheme }: ToggleThemeParams) {
  setTheme(getNextTheme(resolvedTheme));
}

export { getNextTheme, toggleTheme };
