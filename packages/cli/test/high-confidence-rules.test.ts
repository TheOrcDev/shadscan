import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { highConfidenceRules } from "../src/rules/high-confidence";

const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-rules-"));
  tempDirs.push(fixtureDir);

  return fixtureDir;
};

const writeFixtureFile = async (
  rootDir: string,
  filePath: string,
  content: string
): Promise<void> => {
  const absolutePath = path.join(rootDir, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
};

const writeNextPackage = async (
  rootDir: string,
  options: {
    includeToastDependency?: boolean;
    toastDependency?: "radix-ui" | "sonner";
  } = {}
): Promise<void> => {
  const toastDependency =
    options.toastDependency ??
    (options.includeToastDependency ? "sonner" : undefined);
  const dependencies = {
    next: "16.2.6",
    "next-themes": "0.4.6",
    react: "19.2.4",
    ...(toastDependency ? { [toastDependency]: "2.0.0" } : {}),
  };

  await writeFixtureFile(
    rootDir,
    "package.json",
    `${JSON.stringify(
      {
        dependencies,
        name: "rules-fixture",
      },
      null,
      2
    )}\n`
  );
};

const writeComponentsJson = async (rootDir: string): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "components.json",
    `${JSON.stringify(
      {
        aliases: {
          components: "@/components",
          ui: "@/components/ui",
        },
        style: "new-york",
        tailwind: {
          css: "app/globals.css",
        },
      },
      null,
      2
    )}\n`
  );
};

const writeAliasTsconfig = async (rootDir: string): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "tsconfig.json",
    `${JSON.stringify(
      {
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["./*"],
          },
        },
      },
      null,
      2
    )}\n`
  );
};

const writePassingNextApp = async (rootDir: string): Promise<void> => {
  await writeNextPackage(rootDir, { includeToastDependency: true });
  await writeComponentsJson(rootDir);
  await writeFixtureFile(rootDir, "app/favicon.ico", "");
  await writeFixtureFile(
    rootDir,
    "app/layout.tsx",
    `
      import type { Metadata } from "next";
      import { ThemeProvider } from "@/components/theme-provider";
      import { Toaster } from "sonner";

      export const metadata: Metadata = {
        title: "Passing app",
        description: "A good app",
      };

      export default function Layout({ children }: { children: React.ReactNode }) {
        return (
          <html lang="en">
            <body>
              <ThemeProvider>
                {children}
                <Toaster />
              </ThemeProvider>
            </body>
          </html>
        );
      }
    `
  );
  await writeFixtureFile(
    rootDir,
    "app/not-found.tsx",
    "export default function NotFound() { return null; }\n"
  );
  await writeFixtureFile(
    rootDir,
    "app/error.tsx",
    "'use client'; export default function Error() { return null; }\n"
  );
  await writeFixtureFile(
    rootDir,
    "components/theme-provider.tsx",
    `
      "use client";
      import { useEffect } from "react";
      import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";

      export function ThemeProvider({ children }: { children: React.ReactNode }) {
        return <NextThemesProvider attribute="class">{children}<ThemeHotkey /></NextThemesProvider>;
      }

      function ThemeHotkey() {
        const { setTheme } = useTheme();
        useEffect(() => {
          function onKeyDown(event: KeyboardEvent) {
            const target = event.target;
            if (target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
              return;
            }
            if (event.key.toLowerCase() !== "d") {
              return;
            }
            setTheme("dark");
          }
          window.addEventListener("keydown", onKeyDown);
          return () => window.removeEventListener("keydown", onKeyDown);
        }, [setTheme]);
        return null;
      }
    `
  );
};

const writeExtractedThemeHotkey = async (
  rootDir: string,
  helperBody: string
): Promise<void> => {
  await writeFixtureFile(
    rootDir,
    "lib/theme-toggle.ts",
    `
      export function toggleThemeWithTransition({ resolvedTheme, setTheme }) {
        ${helperBody}
      }
    `
  );
  await writeFixtureFile(
    rootDir,
    "components/theme-provider.tsx",
    `
      "use client";
      import { useEffect } from "react";
      import { useTheme } from "next-themes";
      import { toggleThemeWithTransition } from "@/lib/theme-toggle";

      function isTypingTarget(target: EventTarget | null) {
        if (!(target instanceof HTMLElement)) return false;
        return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
      }

      export function ThemeHotkey() {
        const { resolvedTheme, setTheme } = useTheme();
        useEffect(() => {
          function onKeyDown(event: KeyboardEvent) {
            if (event.key.toLowerCase() !== "d") return;
            if (isTypingTarget(event.target)) return;
            toggleThemeWithTransition({ resolvedTheme, setTheme });
          }
          window.addEventListener("keydown", onKeyDown);
          return () => window.removeEventListener("keydown", onKeyDown);
        }, [resolvedTheme, setTheme]);
        return null;
      }
    `
  );
};

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { force: true, recursive: true });
  }
});

describe("high confidence rules", () => {
  it("passes a Next app with the first expected UI fundamentals", async () => {
    const rootDir = await createFixture();
    await writePassingNextApp(rootDir);

    const report = await runAudit(rootDir, {
      rules: highConfidenceRules,
    });

    expect(report.score).toBe(100);
    expect(report.findings.every((finding) => finding.status === "pass")).toBe(
      true
    );
  });

  it("recognizes a theme hotkey guarded by a local predicate", async () => {
    const rootDir = await createFixture();
    await writeNextPackage(rootDir);
    await writeComponentsJson(rootDir);
    await writeFixtureFile(
      rootDir,
      "components/theme-provider.tsx",
      `
        "use client";
        import { useEffect } from "react";
        import { useTheme } from "next-themes";

        function isTypingTarget(target: EventTarget | null) {
          if (!(target instanceof HTMLElement)) return false;
          return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
        }

        export function ThemeHotkey() {
          const { resolvedTheme, setTheme } = useTheme();
          useEffect(() => {
            function onKeyDown(event: KeyboardEvent) {
              if (event.key.toLowerCase() !== "d") return;
              if (isTypingTarget(event.target)) return;
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
            }
            window.addEventListener("keydown", onKeyDown);
            return () => window.removeEventListener("keydown", onKeyDown);
          }, [resolvedTheme, setTheme]);
          return null;
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: highConfidenceRules,
    });

    const themeHotkeyFinding = report.findings.find(
      (finding) => finding.id === "theme-hotkey-present"
    );
    expect(themeHotkeyFinding?.status).toBe("pass");
    expect(themeHotkeyFinding?.evidence[0]?.line).toBe(15);
  });

  it("recognizes a theme hotkey that calls an extracted toggle helper", async () => {
    const rootDir = await createFixture();
    await writeNextPackage(rootDir);
    await writeComponentsJson(rootDir);
    await writeAliasTsconfig(rootDir);
    await writeExtractedThemeHotkey(
      rootDir,
      'setTheme(resolvedTheme === "dark" ? "light" : "dark");'
    );

    const report = await runAudit(rootDir, {
      rules: highConfidenceRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "theme-hotkey-present")
        ?.status
    ).toBe("pass");
  });

  it("rejects a no-op extracted theme toggle helper", async () => {
    const rootDir = await createFixture();
    await writeNextPackage(rootDir);
    await writeComponentsJson(rootDir);
    await writeAliasTsconfig(rootDir);
    await writeExtractedThemeHotkey(rootDir, "return resolvedTheme;");

    const report = await runAudit(rootDir, {
      rules: highConfidenceRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "theme-hotkey-present")
        ?.status
    ).toBe("fail");
  });

  it("reports missing Next fundamentals with evidence and remediation", async () => {
    const rootDir = await createFixture();
    await writeNextPackage(rootDir);
    await writeComponentsJson(rootDir);
    await writeFixtureFile(rootDir, "app/favicon.ico", "");
    await writeFixtureFile(
      rootDir,
      "app/layout.tsx",
      `
        import { ThemeProvider } from "@/components/theme-provider";
        export default function Layout({ children }: { children: React.ReactNode }) {
          return <html lang="en"><body><ThemeProvider>{children}</ThemeProvider></body></html>;
        }
      `
    );
    await writeFixtureFile(
      rootDir,
      "components/theme-provider.tsx",
      `
        "use client";
        import { useEffect } from "react";
        import { useTheme } from "next-themes";
        export function ThemeProvider({ children }: { children: React.ReactNode }) {
          const { setTheme } = useTheme();
          useEffect(() => {
            function onKeyDown(event: KeyboardEvent) {
              if (event.target instanceof HTMLElement && event.target.tagName === "INPUT") return;
              if (event.key.toLowerCase() !== "d") return;
              setTheme("dark");
            }
            window.addEventListener("keydown", onKeyDown);
          }, [setTheme]);
          return children;
        }
      `
    );

    const report = await runAudit(rootDir, {
      rules: highConfidenceRules,
    });
    const failingIds = report.findings
      .filter((finding) => finding.status === "fail")
      .map((finding) => finding.id);

    expect(failingIds).toEqual([
      "metadata-configured",
      "not-found-route-present",
      "error-boundary-present",
      "toast-provider-present",
    ]);
    expect(
      report.findings.find((finding) => finding.id === "theme-hotkey-present")
        ?.status
    ).toBe("pass");
    expect(report.score).toBeLessThan(100);
  });

  it("rejects placeholder toaster components without runtime provenance", async () => {
    const rootDir = await createFixture();
    await writeNextPackage(rootDir, { includeToastDependency: true });
    await writeComponentsJson(rootDir);
    await writeFixtureFile(
      rootDir,
      "app/layout.tsx",
      'import { Toaster } from "@/components/toaster"; export default function Layout() { return <html><body><Toaster /></body></html>; }'
    );
    await writeFixtureFile(
      rootDir,
      "components/toaster.tsx",
      'export function Toaster() { return <div aria-live="polite" />; }'
    );

    const report = await runAudit(rootDir, {
      rules: highConfidenceRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "toast-provider-present")
        ?.status
    ).toBe("fail");
  });

  it("recognizes a mounted Radix umbrella toast wrapper", async () => {
    const rootDir = await createFixture();
    await writeNextPackage(rootDir, { toastDependency: "radix-ui" });
    await writeComponentsJson(rootDir);
    await writeAliasTsconfig(rootDir);
    await writeFixtureFile(
      rootDir,
      "app/layout.tsx",
      `
        import { Toaster } from "@/components/ui/toaster";
        export default function Layout({ children }: { children: React.ReactNode }) {
          return <html><body>{children}<Toaster /></body></html>;
        }
      `
    );
    await writeFixtureFile(
      rootDir,
      "components/ui/toaster.tsx",
      `
        import { ToastProvider, ToastViewport } from "@/components/ui/toast";
        export function Toaster() {
          return <ToastProvider><ToastViewport /></ToastProvider>;
        }
      `
    );
    await writeFixtureFile(
      rootDir,
      "components/ui/toast.tsx",
      `
        import { Toast as ToastPrimitives } from "radix-ui";
        export const ToastProvider = ToastPrimitives.Provider;
        export const ToastViewport = ToastPrimitives.Viewport;
      `
    );

    const report = await runAudit(rootDir, {
      rules: highConfidenceRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "toast-provider-present")
        ?.status
    ).toBe("pass");
  });

  it("rejects unrelated Radix umbrella imports in toast-like wrappers", async () => {
    const rootDir = await createFixture();
    await writeNextPackage(rootDir, { toastDependency: "radix-ui" });
    await writeComponentsJson(rootDir);
    await writeAliasTsconfig(rootDir);
    await writeFixtureFile(
      rootDir,
      "app/layout.tsx",
      'import { Toaster } from "@/components/toaster"; export default function Layout() { return <html><body><Toaster /></body></html>; }'
    );
    await writeFixtureFile(
      rootDir,
      "components/toaster.tsx",
      'import { Accordion } from "radix-ui"; export function Toaster() { return <div>{String(Accordion)}</div>; }'
    );

    const report = await runAudit(rootDir, {
      rules: highConfidenceRules,
    });

    expect(
      report.findings.find((finding) => finding.id === "toast-provider-present")
        ?.status
    ).toBe("fail");
  });

  it("supports Vite metadata and favicon detection", async () => {
    const rootDir = await createFixture();
    await writeFixtureFile(
      rootDir,
      "package.json",
      `${JSON.stringify(
        {
          dependencies: {
            react: "19.2.4",
            vite: "7.2.0",
          },
        },
        null,
        2
      )}\n`
    );
    await writeComponentsJson(rootDir);
    await writeFixtureFile(
      rootDir,
      "index.html",
      `
        <html>
          <head>
            <title>Vite app</title>
            <meta name="description" content="Vite description" />
            <link rel="icon" href="/favicon.ico" />
          </head>
          <body><div id="root"></div></body>
        </html>
      `
    );
    await writeFixtureFile(rootDir, "src/main.tsx", "import './style.css';\n");

    const report = await runAudit(rootDir, {
      rules: highConfidenceRules,
    });

    expect(report.framework.adapter).toBe("vite-react");
    expect(
      report.findings.find((finding) => finding.id === "metadata-configured")
        ?.status
    ).toBe("pass");
    expect(
      report.findings.find((finding) => finding.id === "favicon-present")
        ?.status
    ).toBe("pass");
  });
});
