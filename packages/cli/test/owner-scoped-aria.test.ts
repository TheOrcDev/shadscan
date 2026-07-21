import { describe, expect, it } from "vitest";
import type { AuditFinding } from "../src/audit";
import { runAudit } from "../src/audit";
import { accessibilityRules } from "../src/rules/accessibility";
import { customControlsHaveLabelsRule } from "../src/rules/custom-controls-have-labels";
import { invalidFieldsAssociatedWithErrorsRule } from "../src/rules/invalid-fields-associated-with-errors";
import { createRuleFixture, runRule } from "./rule-fixture";

const runFormsHaveLabelsRule = async (
  rootDir: string
): Promise<AuditFinding> => {
  const report = await runAudit(rootDir, { rules: accessibilityRules });
  const finding = report.findings.find(
    (candidate) => candidate.id === "forms-have-labels"
  );

  if (!finding) {
    throw new Error("Rule forms-have-labels did not produce a finding.");
  }

  return finding;
};

describe("owner-scoped ARIA references", () => {
  it("does not correlate static form label IDs across component owners", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/contact.tsx",
        `
          function UnrelatedLabel() {
            return <label htmlFor="email">Email</label>;
          }
          export function Contact() {
            return <input id="email" />;
          }
        `
      );

      expect((await runFormsHaveLabelsRule(fixture.rootDir)).status).toBe(
        "fail"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not correlate expression form label IDs across component owners", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/contact.tsx",
        `
          function UnrelatedLabel({ field }) {
            return <label htmlFor={\`\${field.id}-input\`}>Email</label>;
          }
          export function Contact({ field }) {
            return <input id={\`\${field.id}-input\`} />;
          }
        `
      );

      expect((await runFormsHaveLabelsRule(fixture.rootDir)).status).toBe(
        "fail"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("continues to correlate form label IDs within one owner", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/contact.tsx",
        `
          export function Contact({ field }) {
            return (
              <>
                <label htmlFor="email">Email</label>
                <input id="email" />
                <label htmlFor={\`\${field.id}-input\`}>Dynamic email</label>
                <input id={\`\${field.id}-input\`} />
              </>
            );
          }
        `
      );

      expect((await runFormsHaveLabelsRule(fixture.rootDir)).status).toBe(
        "pass"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not correlate static custom-control IDs across component owners", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/settings.tsx",
        `
          function UnrelatedLabel() {
            return <Label htmlFor="alerts">Alerts</Label>;
          }
          export function Settings() {
            return <Switch id="alerts" />;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, customControlsHaveLabelsRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not correlate expression custom-control IDs across component owners", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/settings.tsx",
        `
          function UnrelatedLabel({ row }) {
            return <Label htmlFor={\`\${row.id}-status\`}>Status</Label>;
          }
          export function Settings({ row }) {
            return <SelectTrigger id={\`\${row.id}-status\`} />;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, customControlsHaveLabelsRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves error-description IDs only within the control owner", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/contact.tsx",
        `
          function UnrelatedError() {
            return <FieldError id="email-error">Invalid email</FieldError>;
          }
          export function Contact() {
            return <Input aria-invalid="true" aria-errormessage="email-error" />;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, invalidFieldsAssociatedWithErrorsRule))
          .status
      ).toBe("fail");

      await fixture.write(
        "src/contact.tsx",
        `
          export function Contact() {
            return (
              <>
                <Input aria-invalid="true" aria-errormessage="email-error" />
                <FieldError id="email-error">Invalid email</FieldError>
              </>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, invalidFieldsAssociatedWithErrorsRule))
          .status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });
});
