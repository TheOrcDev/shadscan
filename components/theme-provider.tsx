"use client";

import { useServerInsertedHTML } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toggleThemeWithTransition } from "@/lib/theme-toggle";

const STORAGE_KEY = "theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  resolvedTheme?: ResolvedTheme;
  setTheme: (theme: string) => void;
  systemTheme?: ResolvedTheme;
  theme?: Theme;
  themes: string[];
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Injected during SSR via useServerInsertedHTML so React 19 never sees a
 * client-rendered <script> (next-themes triggers a dev overlay warning).
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}")||"system";var r=t==="system"?(window.matchMedia("${MEDIA_QUERY}").matches?"dark":"light"):t;var d=document.documentElement;d.classList.remove("light","dark");d.classList.add(r);d.style.colorScheme=r;}catch(e){}})();`;

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(MEDIA_QUERY).matches ? "dark" : "light";
}

function normalizeTheme(
  value: string | null | undefined,
  fallback: Theme
): Theme {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return fallback;
}

function applyTheme(resolved: ResolvedTheme, disableTransition: boolean) {
  const root = document.documentElement;

  if (disableTransition) {
    const style = document.createElement("style");
    style.appendChild(
      document.createTextNode(
        "*,*::before,*::after{-webkit-transition:none!important;-moz-transition:none!important;-o-transition:none!important;-ms-transition:none!important;transition:none!important}"
      )
    );
    document.head.appendChild(style);
    window.getComputedStyle(document.body);
    setTimeout(() => {
      style.remove();
    }, 1);
  }

  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

interface ThemeProviderProps {
  attribute?: string;
  children: ReactNode;
  defaultTheme?: Theme;
  disableTransitionOnChange?: boolean;
  enableSystem?: boolean;
}

function ThemeProvider({
  children,
  defaultTheme = "system",
  disableTransitionOnChange = true,
  enableSystem = true,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  useServerInsertedHTML(() => (
    // Static FOUC-prevention script only — no user input.
    // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed theme bootstrap script
    <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
  ));

  useEffect(() => {
    const stored = normalizeTheme(
      localStorage.getItem(STORAGE_KEY),
      defaultTheme
    );
    const system = getSystemTheme();
    setSystemTheme(system);
    setThemeState(stored);
    setMounted(true);

    const mediaQuery = window.matchMedia(MEDIA_QUERY);
    const onMediaChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", onMediaChange);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) {
        return;
      }
      setThemeState(normalizeTheme(event.newValue, defaultTheme));
    };
    window.addEventListener("storage", onStorage);

    return () => {
      mediaQuery.removeEventListener("change", onMediaChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [defaultTheme]);

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    if (!mounted) {
      return;
    }
    applyTheme(resolvedTheme, disableTransitionOnChange);
  }, [disableTransitionOnChange, mounted, resolvedTheme]);

  const setTheme = useCallback((next: string) => {
    const normalized = normalizeTheme(next, "system");
    setThemeState(normalized);
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // localStorage can be unavailable in private mode
    }
  }, []);

  const value = useMemo(
    () => ({
      theme: mounted ? theme : undefined,
      setTheme,
      resolvedTheme: mounted ? resolvedTheme : undefined,
      systemTheme: mounted ? systemTheme : undefined,
      themes: enableSystem ? ["light", "dark", "system"] : ["light", "dark"],
    }),
    [enableSystem, mounted, resolvedTheme, setTheme, systemTheme, theme]
  );

  return (
    <ThemeContext.Provider value={value}>
      <ThemeHotkey />
      {children}
    </ThemeContext.Provider>
  );
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() !== "d") {
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      toggleThemeWithTransition({ resolvedTheme, setTheme });
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [resolvedTheme, setTheme]);

  return null;
}

function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    return {
      theme: undefined,
      setTheme: (_theme: string) => {
        // no-op outside provider
      },
      resolvedTheme: undefined,
      systemTheme: undefined,
      themes: [] as string[],
    };
  }

  return context;
}

export { ThemeProvider, useTheme };
