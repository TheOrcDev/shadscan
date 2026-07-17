import { describe, expect, it } from "vitest";
import { destructiveActionsConfirmedRule } from "../src/rules/destructive-actions-confirmed";
import { headingStructureSaneRule } from "../src/rules/heading-structure-sane";
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
});
