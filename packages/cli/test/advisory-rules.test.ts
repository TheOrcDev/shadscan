import { describe, expect, it } from "vitest";
import { headingStructureSaneRule } from "../src/rules/heading-structure-sane";
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
});
