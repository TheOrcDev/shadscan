import { describe, expect, it } from "vitest";
import { componentsAliasesResolveRule } from "../src/rules/components-aliases-resolve";
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
});
