import { describe, expect, it } from "vitest";
import { animationsRespectReducedMotionRule } from "../src/rules/animations-respect-reduced-motion";
import { colorContrastPassesRule } from "../src/rules/color-contrast-passes";
import { destructiveActionsConfirmedRule } from "../src/rules/destructive-actions-confirmed";
import { dialogFocusTrapWorksRule } from "../src/rules/dialog-focus-trap-works";
import { headingStructureSaneRule } from "../src/rules/heading-structure-sane";
import { keyboardNavigationWorksRule } from "../src/rules/keyboard-navigation-works";
import { mobileOverflowAbsentRule } from "../src/rules/mobile-overflow-absent";
import { pointerTargetSizePassesRule } from "../src/rules/pointer-target-size-passes";
import { publicAppSeoFilesPresentRule } from "../src/rules/public-app-seo-files-present";
import { responsiveShellPresentRule } from "../src/rules/responsive-shell-present";
import { createRuleFixture, runRule } from "./rule-fixture";

describe("browser-sensitive advisory rules", () => {
  it("keeps every browser-sensitive rule score-neutral", () => {
    const browserSensitiveRules = [
      headingStructureSaneRule,
      responsiveShellPresentRule,
      destructiveActionsConfirmedRule,
      animationsRespectReducedMotionRule,
      publicAppSeoFilesPresentRule,
      dialogFocusTrapWorksRule,
      keyboardNavigationWorksRule,
      colorContrastPassesRule,
      pointerTargetSizePassesRule,
      mobileOverflowAbsentRule,
    ];

    expect(browserSensitiveRules.every((rule) => rule.maxScore === 0)).toBe(
      true
    );
  });

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
        'export function Account() { return <Button onClick={deleteAccount} variant="destructive">Delete account</Button>; }'
      );
      expect(
        (await runRule(fixture.rootDir, destructiveActionsConfirmedRule)).status
      ).toBe("advisory");

      await fixture.write(
        "src/account.tsx",
        'export function Account() { return <AlertDialog><Button onClick={deleteAccount} variant="destructive">Delete account</Button></AlertDialog>; }'
      );
      expect(
        (await runRule(fixture.rootDir, destructiveActionsConfirmedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("ignores destructive styling on non-interactive badges", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/equipment.tsx",
        'export function Equipment() { return <Badge variant="destructive">Coming soon</Badge>; }'
      );
      expect(
        (await runRule(fixture.rootDir, destructiveActionsConfirmedRule)).status
      ).toBe("not-applicable");
    } finally {
      await fixture.cleanup();
    }
  });

  it("ignores inert destructive component showcases", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/showcase.tsx",
        'export function Showcase() { return <><Button variant="destructive">Destructive</Button><DropdownMenuItem>Delete</DropdownMenuItem></>; }'
      );
      expect(
        (await runRule(fixture.rootDir, destructiveActionsConfirmedRule)).status
      ).toBe("not-applicable");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not correlate unrelated confirmation UI", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/account.tsx",
        'export function Account() { return <Button onClick={deleteAccount} variant="destructive">Delete account</Button>; }'
      );
      await fixture.write(
        "src/profile.tsx",
        "export function Profile() { return <AlertDialog>Confirm profile reset</AlertDialog>; }"
      );
      expect(
        (await runRule(fixture.rootDir, destructiveActionsConfirmedRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("detects destructive handlers on interactive elements", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/account.tsx",
        "export function Account() { return <button onClick={deleteAccount}>Close account</button>; }"
      );
      expect(
        (await runRule(fixture.rootDir, destructiveActionsConfirmedRule)).status
      ).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("ignores destructive method names in non-UI source", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/archive.ts",
        "export const abortArchive = (archive: { destroy: () => void }) => archive.destroy();"
      );
      expect(
        (await runRule(fixture.rootDir, destructiveActionsConfirmedRule)).status
      ).toBe("not-applicable");
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

  it("does not treat animation stylesheet imports as rendered motion", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/globals.css",
        '@import "tailwindcss";\n@import "tw-animate-css";'
      );
      expect(
        (await runRule(fixture.rootDir, animationsRespectReducedMotionRule))
          .status
      ).toBe("not-applicable");
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

  it("calls out obviously small pointer targets for browser verification", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/icon-button.tsx",
        'export function IconButton() { return <button className="size-5" aria-label="Close" />; }'
      );
      const finding = await runRule(
        fixture.rootDir,
        pointerTargetSizePassesRule
      );
      expect(finding.status).toBe("advisory");
      expect(finding.evidence[0]?.message).toContain("below the 24px");
    } finally {
      await fixture.cleanup();
    }
  });

  it("calls out obvious mobile overflow risks for browser verification", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/dashboard.tsx",
        'export function Dashboard() { return <main className="w-screen">Content</main>; }'
      );
      const finding = await runRule(fixture.rootDir, mobileOverflowAbsentRule);
      expect(finding.status).toBe("advisory");
      expect(finding.evidence[0]?.message).toContain("overflow-prone");
    } finally {
      await fixture.cleanup();
    }
  });

  it("ignores viewport hints in responsive image sizes", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/project-grid.tsx",
        'export function ProjectGrid() { return <Image fill sizes="(min-width: 640px) 50vw, 100vw" />; }'
      );
      const finding = await runRule(fixture.rootDir, mobileOverflowAbsentRule);
      expect(finding.status).toBe("advisory");
      expect(finding.evidence[0]?.message).not.toContain("overflow-prone");
      expect(finding.evidence[0]?.filePath).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it("detects static inline and stylesheet width risks", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/dashboard.tsx",
        'export function Dashboard() { return <div style={{ minWidth: "900px" }}>Content</div>; }'
      );
      expect(
        (await runRule(fixture.rootDir, mobileOverflowAbsentRule)).evidence[0]
          ?.message
      ).toContain("overflow-prone");

      await fixture.write(
        "src/dashboard.tsx",
        'export function Dashboard() { return <div className="max-w-full">Content</div>; }'
      );
      await fixture.write("src/dashboard.css", ".wide { width: 100vw; }");
      expect(
        (await runRule(fixture.rootDir, mobileOverflowAbsentRule)).evidence[0]
          ?.message
      ).toContain("overflow-prone");
    } finally {
      await fixture.cleanup();
    }
  });

  it("ignores viewport widths inside intentional overflow containment", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/spotlight.tsx",
        `
          export function Spotlight() {
            return (
              <div className="absolute inset-0 overflow-hidden">
                <div className="absolute h-screen w-screen" />
              </div>
            );
          }
        `
      );
      const finding = await runRule(fixture.rootDir, mobileOverflowAbsentRule);
      expect(finding.evidence[0]?.message).not.toContain("overflow-prone");
    } finally {
      await fixture.cleanup();
    }
  });

  it("ignores overflow vocabulary outside layout-bearing contexts", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/article.tsx",
        'export function Article() { return <main className="max-w-screen-lg"><p>Avoid writing width: 100vw in constrained layouts.</p></main>; }'
      );
      const finding = await runRule(fixture.rootDir, mobileOverflowAbsentRule);
      expect(finding.evidence[0]?.message).not.toContain("overflow-prone");
    } finally {
      await fixture.cleanup();
    }
  });
});
