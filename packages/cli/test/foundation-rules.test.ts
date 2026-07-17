import { describe, expect, it } from "vitest";
import { componentsAliasesResolveRule } from "../src/rules/components-aliases-resolve";
import { metadataTitleDescriptionCompleteRule } from "../src/rules/metadata-title-description-complete";
import { themeHydrationSafeRule } from "../src/rules/theme-hydration-safe";
import { themeProviderMountedInShellRule } from "../src/rules/theme-provider-mounted-in-shell";
import { createRuleFixture, runRule } from "./rule-fixture";

describe("foundation rules", () => {
  it("checks that shadcn aliases match configured path mappings", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "components.json",
        JSON.stringify({ aliases: { components: "@/components" } })
      );
      await fixture.write(
        "tsconfig.json",
        JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } })
      );

      expect(
        (await runRule(fixture.rootDir, componentsAliasesResolveRule)).status
      ).toBe("pass");

      await fixture.write(
        "tsconfig.json",
        JSON.stringify({ compilerOptions: { paths: { "~/*": ["./*"] } } })
      );

      const finding = await runRule(
        fixture.rootDir,
        componentsAliasesResolveRule
      );
      expect(finding.status).toBe("fail");
      expect(finding.evidence[0]?.message).toContain(
        "components (@/components)"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires the theme provider to be mounted in the app shell", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      "next-themes": "0.4.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        `
          import { ThemeProvider } from "@/components/theme-provider";
          export default function Layout({ children }: { children: React.ReactNode }) {
            return <html><body><ThemeProvider>{children}</ThemeProvider></body></html>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, themeProviderMountedInShellRule)).status
      ).toBe("pass");

      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html><body>{children}</body></html>; }"
      );

      expect(
        (await runRule(fixture.rootDir, themeProviderMountedInShellRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("checks Next theme hydration safeguards", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      "next-themes": "0.4.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html suppressHydrationWarning><body>{children}</body></html>; }"
      );
      await fixture.write(
        "components/theme-provider.tsx",
        'export function ThemeProvider({ children }) { return <NextThemesProvider attribute="class">{children}</NextThemesProvider>; }'
      );

      expect(
        (await runRule(fixture.rootDir, themeHydrationSafeRule)).status
      ).toBe("pass");

      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html><body>{children}</body></html>; }"
      );

      expect(
        (await runRule(fixture.rootDir, themeHydrationSafeRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires complete title and description metadata", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        `
          export const metadata = {
            title: "Acme dashboard",
            description: "Manage Acme projects",
          };
          export default function Layout({ children }) { return <html>{children}</html>; }
        `
      );
      expect(
        (await runRule(fixture.rootDir, metadataTitleDescriptionCompleteRule))
          .status
      ).toBe("pass");

      await fixture.write(
        "app/layout.tsx",
        'export const metadata = { title: "Acme" }; export default function Layout() { return <html />; }'
      );
      expect(
        (await runRule(fixture.rootDir, metadataTitleDescriptionCompleteRule))
          .status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });
});
