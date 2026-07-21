import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { commandMenuPresentRule } from "../src/rules/command-menu-present";
import { highConfidenceRules } from "../src/rules/high-confidence";
import { htmlLangPresentRule } from "../src/rules/html-lang-present";
import { metadataTitleDescriptionCompleteRule } from "../src/rules/metadata-title-description-complete";
import { notFoundRecoveryPresentRule } from "../src/rules/not-found-recovery-present";
import { socialPreviewPresentRule } from "../src/rules/social-preview-present";
import { themeProviderMountedInShellRule } from "../src/rules/theme-provider-mounted-in-shell";
import { toastProviderMountedRule } from "../src/rules/toast-provider-mounted";
import { createRuleFixture } from "./rule-fixture";

const HYBRID_RULES = [
  ...highConfidenceRules,
  htmlLangPresentRule,
  metadataTitleDescriptionCompleteRule,
  socialPreviewPresentRule,
  themeProviderMountedInShellRule,
  commandMenuPresentRule,
  toastProviderMountedRule,
  notFoundRecoveryPresentRule,
];

const getStatus = (
  report: Awaited<ReturnType<typeof runAudit>>,
  findingId: string
): string | undefined =>
  report.findings.find((finding) => finding.id === findingId)?.status;

describe("Next hybrid router support", () => {
  it("audits both route roots and both application shells", async () => {
    const fixture = await createRuleFixture({
      cmdk: "1.1.1",
      next: "16.2.6",
      "next-themes": "0.4.6",
      react: "19.2.4",
      sonner: "2.0.7",
    });

    try {
      await fixture.write("components.json", JSON.stringify({ aliases: {} }));
      await fixture.write(
        "app/layout.tsx",
        `
          export const metadata = {
            title: "App routes",
            description: "App Router routes",
            openGraph: { images: ["/app.png"] },
          };
          export default function Layout({ children }) {
            return <html lang="en"><body><ThemeProvider>{children}</ThemeProvider></body></html>;
          }
        `
      );
      await fixture.write(
        "app/not-found.tsx",
        'export default function NotFound() { return <a href="/">Home</a>; }'
      );
      await fixture.write(
        "app/error.tsx",
        "export default function ErrorPage() { return <p>Error</p>; }"
      );
      await fixture.write(
        "pages/_app.tsx",
        "export default function App({ Component, pageProps }) { return <Component {...pageProps} />; }"
      );
      await fixture.write(
        "pages/_document.tsx",
        "export default function Document() { return <Html><body><Main /></body></Html>; }"
      );
      await fixture.write(
        "pages/index.tsx",
        "export default function Page() { return <Head><title>Pages routes</title></Head>; }"
      );
      await fixture.write(
        "components/command-menu.tsx",
        `
          import { CommandDialog, CommandEmpty, CommandInput, CommandItem } from "cmdk";
          export function CommandMenu() {
            return <CommandDialog><CommandInput /><CommandEmpty>Empty</CommandEmpty><CommandItem>Home</CommandItem></CommandDialog>;
          }
        `
      );

      const incompleteReport = await runAudit(fixture.rootDir, {
        rules: HYBRID_RULES,
      });

      expect(incompleteReport.framework.adapter).toBe("next-hybrid-router");
      expect(getStatus(incompleteReport, "metadata-configured")).toBe("fail");
      expect(getStatus(incompleteReport, "not-found-route-present")).toBe(
        "fail"
      );
      expect(getStatus(incompleteReport, "error-boundary-present")).toBe(
        "fail"
      );
      expect(getStatus(incompleteReport, "html-lang-present")).toBe("fail");
      expect(
        getStatus(incompleteReport, "metadata-title-description-complete")
      ).toBe("fail");
      expect(getStatus(incompleteReport, "social-preview-present")).toBe(
        "fail"
      );
      expect(
        getStatus(incompleteReport, "theme-provider-mounted-in-shell")
      ).toBe("fail");
      expect(getStatus(incompleteReport, "command-menu-present")).toBe("fail");
      expect(getStatus(incompleteReport, "toast-provider-mounted")).toBe(
        "fail"
      );

      await fixture.write(
        "pages/_app.tsx",
        `
          import { CommandMenu } from "../components/command-menu";
          import { Toaster } from "sonner";
          export default function App({ Component, pageProps }) {
            return <ThemeProvider><Component {...pageProps} /><CommandMenu /><Toaster /></ThemeProvider>;
          }
        `
      );
      await fixture.write(
        "pages/_document.tsx",
        'export default function Document() { return <Html lang="en"><body><Main /></body></Html>; }'
      );
      await fixture.write(
        "pages/index.tsx",
        `
          export default function Page() {
            return <Head><title>Pages routes</title><meta name="description" content="Pages Router routes" /><meta property="og:image" content="/pages.png" /></Head>;
          }
        `
      );
      await fixture.write(
        "pages/404.tsx",
        'export default function NotFound() { return <a href="/">Home</a>; }'
      );
      await fixture.write(
        "pages/_error.tsx",
        "export default function ErrorPage() { return <p>Error</p>; }"
      );

      const completeReport = await runAudit(fixture.rootDir, {
        rules: HYBRID_RULES,
      });
      const expectedPassingFindings = [
        "metadata-configured",
        "not-found-route-present",
        "error-boundary-present",
        "toast-provider-present",
        "html-lang-present",
        "metadata-title-description-complete",
        "social-preview-present",
        "theme-provider-mounted-in-shell",
        "command-menu-present",
        "toast-provider-mounted",
        "not-found-recovery-present",
      ];

      for (const findingId of expectedPassingFindings) {
        expect(getStatus(completeReport, findingId), findingId).toBe("pass");
      }
    } finally {
      await fixture.cleanup();
    }
  });
});
