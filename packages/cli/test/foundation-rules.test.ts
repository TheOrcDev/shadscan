import { describe, expect, it } from "vitest";
import { componentsAliasesResolveRule } from "../src/rules/components-aliases-resolve";
import { metadataTitleDescriptionCompleteRule } from "../src/rules/metadata-title-description-complete";
import { noStarterCopyRule } from "../src/rules/no-starter-copy";
import { socialPreviewPresentRule } from "../src/rules/social-preview-present";
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
      await fixture.write(
        "components/Button.tsx",
        "export function Button() { return <button />; }"
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

  it("resolves inherited path mappings only when their targets exist", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "components.json",
        JSON.stringify({
          aliases: {
            ui: "@/components/ui",
            utils: "@/lib/utils",
          },
        })
      );
      await fixture.write(
        "config/tsconfig.base.json",
        JSON.stringify({
          compilerOptions: { paths: { "@/*": ["../src/*"] } },
        })
      );
      await fixture.write(
        "tsconfig.json",
        JSON.stringify({ extends: "./config/tsconfig.base.json" })
      );
      await fixture.write(
        "src/components/ui/Button.tsx",
        "export function Button() { return <button />; }"
      );
      await fixture.write(
        "src/lib/utils.ts",
        "export const cn = (...values: string[]) => values.join(' ');"
      );

      expect(
        (await runRule(fixture.rootDir, componentsAliasesResolveRule)).status
      ).toBe("pass");

      await fixture.write(
        "config/tsconfig.base.json",
        JSON.stringify({
          compilerOptions: { paths: { "@/*": ["../missing/*"] } },
        })
      );

      const finding = await runRule(
        fixture.rootDir,
        componentsAliasesResolveRule
      );

      expect(finding.status).toBe("fail");
      expect(finding.evidence[0]?.message).toContain("ui (@/components/ui)");
    } finally {
      await fixture.cleanup();
    }
  });

  it("accepts unused shadcn aliases covered by an existing wildcard root", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "components.json",
        JSON.stringify({
          aliases: {
            hooks: "@/hooks",
          },
        })
      );
      await fixture.write(
        "tsconfig.json",
        JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } })
      );
      await fixture.write(
        "app/page.tsx",
        "export default function Page() { return <main />; }"
      );

      expect(
        (await runRule(fixture.rootDir, componentsAliasesResolveRule)).status
      ).toBe("pass");
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

  it("evaluates Next metadata through the route hierarchy", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        `
          export const metadata = {
            title: "Acme",
            description: "Acme projects",
          };
          export default function Layout({ children }) { return <html>{children}</html>; }
        `
      );
      await fixture.write(
        "app/blog/[slug]/page.tsx",
        `
          export async function generateMetadata() {
            const post = await getPost();
            return { title: post.title, openGraph: { title: post.title } };
          }
          export default function Page() { return <main />; }
        `
      );

      expect(
        (await runRule(fixture.rootDir, metadataTitleDescriptionCompleteRule))
          .status
      ).toBe("pass");

      await fixture.write(
        "app/blog/[slug]/page.tsx",
        `
          export async function generateMetadata() {
            return { title: "Blog", description: "" };
          }
          export default function Page() { return <main />; }
        `
      );
      const emptyOverride = await runRule(
        fixture.rootDir,
        metadataTitleDescriptionCompleteRule
      );
      expect(emptyOverride.status).toBe("fail");
      expect(emptyOverride.evidence[0]?.filePath).toContain(
        "app/blog/[slug]/page.tsx"
      );

      await fixture.write(
        "app/layout.tsx",
        'export const metadata = { title: "Acme" }; export default function Layout({ children }) { return <html>{children}</html>; }'
      );
      const incompleteRoot = await runRule(
        fixture.rootDir,
        metadataTitleDescriptionCompleteRule
      );
      expect(incompleteRoot.status).toBe("fail");
      expect(incompleteRoot.evidence[0]?.filePath).toContain("app/layout.tsx");
    } finally {
      await fixture.cleanup();
    }
  });

  it("supports complete page metadata without a root metadata export", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html>{children}</html>; }"
      );
      await fixture.write(
        "app/page.tsx",
        'export const metadata = { title: "Home", description: "Acme home" }; export default function Page() { return <main />; }'
      );

      expect(
        (await runRule(fixture.rootDir, metadataTitleDescriptionCompleteRule))
          .status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("detects image-backed social previews", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        'export const metadata = { openGraph: { images: ["/share.png"] } }; export default function Layout() { return <html />; }'
      );
      expect(
        (await runRule(fixture.rootDir, socialPreviewPresentRule)).status
      ).toBe("pass");

      await fixture.write(
        "app/layout.tsx",
        'export const metadata = { title: "No image" }; export default function Layout() { return <html />; }'
      );
      expect(
        (await runRule(fixture.rootDir, socialPreviewPresentRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("flags recognizable framework starter copy", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        "export function App() { return <h1>Welcome to Vite + React</h1>; }"
      );
      expect((await runRule(fixture.rootDir, noStarterCopyRule)).status).toBe(
        "fail"
      );

      await fixture.write(
        "src/App.tsx",
        "export function App() { return <h1>Acme projects</h1>; }"
      );
      expect((await runRule(fixture.rootDir, noStarterCopyRule)).status).toBe(
        "pass"
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
