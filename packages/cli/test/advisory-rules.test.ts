import { describe, expect, it } from "vitest";
import { animationsRespectReducedMotionRule } from "../src/rules/animations-respect-reduced-motion";
import { colorContrastPassesRule } from "../src/rules/color-contrast-passes";
import { destructiveActionsConfirmedRule } from "../src/rules/destructive-actions-confirmed";
import { dialogFocusTrapWorksRule } from "../src/rules/dialog-focus-trap-works";
import { headingStructureSaneRule } from "../src/rules/heading-structure-sane";
import { keyboardNavigationWorksRule } from "../src/rules/keyboard-navigation-works";
import { publicAppSeoFilesPresentRule } from "../src/rules/public-app-seo-files-present";
import { responsiveShellPresentRule } from "../src/rules/responsive-shell-present";
import { createRuleFixture, runRule } from "./rule-fixture";

describe("browser-sensitive advisory rules", () => {
  it("advises on an obvious heading-level skip without reducing score", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/page.tsx",
        "export function Page() { return <main><h1>Account</h1><h3>Security</h3></main>; }"
      );
      const advisory = await runRule(fixture.rootDir, headingStructureSaneRule);
      expect(advisory.status).toBe("advisory");
      expect(advisory.impactsScore).toBe(false);

      await fixture.write(
        "src/page.tsx",
        "export function Page() { return <main><h1>Account</h1><h2>Security</h2></main>; }"
      );
      expect(
        (await runRule(fixture.rootDir, headingStructureSaneRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("advises when an app shell has no responsive source evidence", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        'export function App() { return <main className="p-4">Content</main>; }'
      );
      expect(
        (await runRule(fixture.rootDir, responsiveShellPresentRule)).status
      ).toBe("advisory");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <main className="p-4 md:grid">Content</main>; }'
      );
      expect(
        (await runRule(fixture.rootDir, responsiveShellPresentRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("advises when destructive actions have no confirmation or undo", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/account.tsx",
        'export function Account() { return <Button variant="destructive">Delete account</Button>; }'
      );
      expect(
        (await runRule(fixture.rootDir, destructiveActionsConfirmedRule)).status
      ).toBe("advisory");

      await fixture.write(
        "src/account.tsx",
        'export function Account() { return <AlertDialog><Button variant="destructive">Delete account</Button></AlertDialog>; }'
      );
      expect(
        (await runRule(fixture.rootDir, destructiveActionsConfirmedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("advises when animated UI has no reduced-motion strategy", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/card.tsx",
        'export function Card() { return <div className="animate-pulse">Loading</div>; }'
      );
      expect(
        (await runRule(fixture.rootDir, animationsRespectReducedMotionRule))
          .status
      ).toBe("advisory");

      await fixture.write(
        "src/card.tsx",
        'export function Card() { return <div className="animate-pulse motion-reduce:animate-none">Loading</div>; }'
      );
      expect(
        (await runRule(fixture.rootDir, animationsRespectReducedMotionRule))
          .status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("advises when an indexable app lacks robots or sitemap files", async () => {
    const fixture = await createRuleFixture({
      next: "16.0.0",
      react: "19.2.4",
    });

    try {
      await fixture.write("app/page.tsx", "export default function Page() {}");
      await fixture.write(
        "app/robots.ts",
        "export default function robots() { return { rules: { allow: '/' } }; }"
      );
      expect(
        (await runRule(fixture.rootDir, publicAppSeoFilesPresentRule)).status
      ).toBe("advisory");

      await fixture.write(
        "app/sitemap.ts",
        "export default function sitemap() { return [{ url: 'https://example.com' }]; }"
      );
      expect(
        (await runRule(fixture.rootDir, publicAppSeoFilesPresentRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("advises when a custom dialog has no focus-managed primitive", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/modal.tsx",
        'export function Modal() { return <div role="dialog" aria-modal="true">Settings</div>; }'
      );
      expect(
        (await runRule(fixture.rootDir, dialogFocusTrapWorksRule)).status
      ).toBe("advisory");

      await fixture.write(
        "src/modal.tsx",
        'import { DialogContent } from "@/components/ui/dialog"; export function Modal() { return <DialogContent>Settings</DialogContent>; }'
      );
      expect(
        (await runRule(fixture.rootDir, dialogFocusTrapWorksRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("advises when a composite widget has no keyboard-aware primitive", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/view-picker.tsx",
        'export function ViewPicker() { return <div role="listbox"><div>Grid</div></div>; }'
      );
      expect(
        (await runRule(fixture.rootDir, keyboardNavigationWorksRule)).status
      ).toBe("advisory");

      await fixture.write(
        "src/view-picker.tsx",
        'import { Tabs } from "@/components/ui/tabs"; export function ViewPicker() { return <Tabs />; }'
      );
      expect(
        (await runRule(fixture.rootDir, keyboardNavigationWorksRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("routes styled color contrast to browser verification", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/banner.tsx",
        'export function Banner() { return <p className="bg-primary text-white">Saved</p>; }'
      );
      const finding = await runRule(fixture.rootDir, colorContrastPassesRule);
      expect(finding.status).toBe("advisory");
      expect(finding.impactsScore).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });
});
