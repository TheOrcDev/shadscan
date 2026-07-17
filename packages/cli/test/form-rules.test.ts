import { describe, expect, it } from "vitest";
import { validationWiredToFormRule } from "../src/rules/validation-wired-to-form";
import { createRuleFixture, runRule } from "./rule-fixture";

describe("form rules", () => {
  it("requires validation to be wired into detected forms", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/contact.tsx",
        'export function Contact() { return <form><input name="email" /></form>; }'
      );
      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/contact.tsx",
        'export function Contact() { return <form><input name="email" type="email" required /></form>; }'
      );
      expect(
        (await runRule(fixture.rootDir, validationWiredToFormRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });
});
