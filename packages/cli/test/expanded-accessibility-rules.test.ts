import { describe, expect, it } from "vitest";
import { htmlLangPresentRule } from "../src/rules/html-lang-present";
import { imagesHaveAltRule } from "../src/rules/images-have-alt";
import { linksHaveAccessibleNamesRule } from "../src/rules/links-have-accessible-names";
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
});
