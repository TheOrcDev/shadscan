import { describe, expect, it } from "vitest";
import { fieldErrorsRenderedRule } from "../src/rules/field-errors-rendered";
import { invalidFieldsAssociatedWithErrorsRule } from "../src/rules/invalid-fields-associated-with-errors";
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

  it("requires custom validation errors to be rendered", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/contact.tsx",
        "export function Contact() { const { formState: { errors } } = useForm(); return <form><Input /></form>; }"
      );
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/contact.tsx",
        "export function Contact() { const { formState: { errors } } = useForm(); return <form><Input />{errors.email && <FieldError>{errors.email.message}</FieldError>}</form>; }"
      );
      expect(
        (await runRule(fixture.rootDir, fieldErrorsRenderedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires aria-invalid controls to reference error content", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/contact.tsx",
        'export function Contact() { return <Input aria-invalid="true" />; }'
      );
      expect(
        (await runRule(fixture.rootDir, invalidFieldsAssociatedWithErrorsRule))
          .status
      ).toBe("fail");

      await fixture.write(
        "src/contact.tsx",
        'export function Contact() { return <><Input aria-invalid="true" aria-describedby="email-error" /><FieldError id="email-error">Invalid email</FieldError></>; }'
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
