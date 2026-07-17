import { describe, expect, it } from "vitest";
import { customControlsHaveLabelsRule } from "../src/rules/custom-controls-have-labels";
import { htmlLangPresentRule } from "../src/rules/html-lang-present";
import { iframesHaveTitleRule } from "../src/rules/iframes-have-title";
import { imagesHaveAltRule } from "../src/rules/images-have-alt";
import { linksHaveAccessibleNamesRule } from "../src/rules/links-have-accessible-names";
import { navLandmarksHaveNamesRule } from "../src/rules/nav-landmarks-have-names";
import { noPositiveTabindexRule } from "../src/rules/no-positive-tabindex";
import { createRuleFixture, runRule } from "./rule-fixture";

describe("expanded accessibility rules", () => {
  it("requires a language on the owned document shell", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        'export default function Layout({ children }) { return <html lang="en"><body>{children}</body></html>; }'
      );
      expect((await runRule(fixture.rootDir, htmlLangPresentRule)).status).toBe(
        "pass"
      );

      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html><body>{children}</body></html>; }"
      );
      expect((await runRule(fixture.rootDir, htmlLangPresentRule)).status).toBe(
        "fail"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires alternative text on native and Next images", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Image src="/team.png" />; }'
      );
      expect((await runRule(fixture.rootDir, imagesHaveAltRule)).status).toBe(
        "fail"
      );

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Image src="/team.png" alt="The Acme team" />; }'
      );
      expect((await runRule(fixture.rootDir, imagesHaveAltRule)).status).toBe(
        "pass"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires accessible names on links", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Link href="/settings"><SettingsIcon /></Link>; }'
      );
      expect(
        (await runRule(fixture.rootDir, linksHaveAccessibleNamesRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Link href="/settings">Settings</Link>; }'
      );
      expect(
        (await runRule(fixture.rootDir, linksHaveAccessibleNamesRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires accessible labels on custom controls", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/settings.tsx",
        'export function Settings() { return <Switch id="alerts" />; }'
      );
      expect(
        (await runRule(fixture.rootDir, customControlsHaveLabelsRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/settings.tsx",
        'export function Settings() { return <><Label htmlFor="alerts">Alerts</Label><Switch id="alerts" /></>; }'
      );
      expect(
        (await runRule(fixture.rootDir, customControlsHaveLabelsRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects positive literal tabIndex values", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        "export function App() { return <button tabIndex={2}>Save</button>; }"
      );
      expect(
        (await runRule(fixture.rootDir, noPositiveTabindexRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        "export function App() { return <button tabIndex={0}>Save</button>; }"
      );
      expect(
        (await runRule(fixture.rootDir, noPositiveTabindexRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires meaningful iframe titles", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        'export function App() { return <iframe src="/report" />; }'
      );
      expect(
        (await runRule(fixture.rootDir, iframesHaveTitleRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <iframe src="/report" title="Quarterly report" />; }'
      );
      expect(
        (await runRule(fixture.rootDir, iframesHaveTitleRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires names when multiple navigation landmarks exist", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        "export function App() { return <><nav>Primary</nav><nav>Account</nav></>; }"
      );
      expect(
        (await runRule(fixture.rootDir, navLandmarksHaveNamesRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <><nav aria-label="Primary">Primary</nav><nav aria-label="Account">Account</nav></>; }'
      );
      expect(
        (await runRule(fixture.rootDir, navLandmarksHaveNamesRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });
});
