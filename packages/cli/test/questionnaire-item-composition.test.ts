import { afterEach, describe, expect, it } from "vitest";
import { questionnaireItemCompositionRule } from "../src/rules/questionnaire-item-composition";
import { createRuleFixture, runRule } from "./rule-fixture";

const fixtures: Awaited<ReturnType<typeof createRuleFixture>>[] = [];

const createShadcnFixture = async (): Promise<
  Awaited<ReturnType<typeof createRuleFixture>>
> => {
  const fixture = await createRuleFixture({ react: "19.2.4" });
  fixtures.push(fixture);
  await fixture.write("components.json", "{}\n");
  return fixture;
};

const IMPORTS = `
  import {
    Questionnaire,
    QuestionnaireChoice,
    QuestionnaireChoices,
    QuestionnaireError,
    QuestionnaireItem,
    QuestionnaireTitle,
  } from "@/components/ui/questionnaire";
`;

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.cleanup();
  }
});

describe("questionnaire-item-composition", () => {
  it("passes the canonical composition", async () => {
    // The shape from shadcn's own questionnaire-example. A hit here would be a
    // false positive by definition, so this is the load-bearing negative test.
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/survey.tsx",
      `
        ${IMPORTS}

        export function Survey() {
          return (
            <Questionnaire items={items}>
              <QuestionnaireItem name="task" required>
                <QuestionnaireTitle>What next?</QuestionnaireTitle>
                <QuestionnaireChoices>
                  <QuestionnaireChoice value="inspect">Inspect</QuestionnaireChoice>
                  <QuestionnaireChoice value="ship">Ship</QuestionnaireChoice>
                </QuestionnaireChoices>
                <QuestionnaireError />
              </QuestionnaireItem>
            </Questionnaire>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      questionnaireItemCompositionRule
    );

    expect(result.status).toBe("pass");
  });

  it("reports a required item with nowhere to render its error", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/survey.tsx",
      `
        ${IMPORTS}

        export function Survey() {
          return (
            <Questionnaire items={items}>
              <QuestionnaireItem name="task" required>
                <QuestionnaireTitle>What next?</QuestionnaireTitle>
                <QuestionnaireChoices>
                  <QuestionnaireChoice value="ship">Ship</QuestionnaireChoice>
                </QuestionnaireChoices>
              </QuestionnaireItem>
            </Questionnaire>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      questionnaireItemCompositionRule
    );

    expect(result.status).toBe("advisory");
    expect(result.evidence?.[0]?.message).toContain("QuestionnaireError");
  });

  it("reports an item with no title", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/survey.tsx",
      `
        ${IMPORTS}

        export function Survey() {
          return (
            <Questionnaire items={items}>
              <QuestionnaireItem name="task">
                <QuestionnaireChoices>
                  <QuestionnaireChoice value="ship">Ship</QuestionnaireChoice>
                </QuestionnaireChoices>
              </QuestionnaireItem>
            </Questionnaire>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      questionnaireItemCompositionRule
    );

    expect(result.status).toBe("advisory");
    expect(result.evidence?.[0]?.message).toContain("QuestionnaireTitle");
  });

  it("finds parts nested below a wrapper", async () => {
    // Parts are routinely wrapped in a layout element; a direct-children scan
    // would report this correct composition as broken.
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/survey.tsx",
      `
        ${IMPORTS}

        export function Survey() {
          return (
            <Questionnaire items={items}>
              <QuestionnaireItem name="task" required>
                <div className="space-y-2">
                  <QuestionnaireTitle>What next?</QuestionnaireTitle>
                  <QuestionnaireError />
                </div>
              </QuestionnaireItem>
            </Questionnaire>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      questionnaireItemCompositionRule
    );

    expect(result.status).toBe("pass");
  });

  it("stays silent on a non-required item with no error", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/survey.tsx",
      `
        ${IMPORTS}

        export function Survey() {
          return (
            <Questionnaire items={items}>
              <QuestionnaireItem name="notes">
                <QuestionnaireTitle>Anything else?</QuestionnaireTitle>
              </QuestionnaireItem>
            </Questionnaire>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      questionnaireItemCompositionRule
    );

    expect(result.status).toBe("pass");
  });

  it("stays silent when required is dynamic", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/survey.tsx",
      `
        ${IMPORTS}

        export function Survey({ strict }: { strict: boolean }) {
          return (
            <Questionnaire items={items}>
              <QuestionnaireItem name="task" required={strict}>
                <QuestionnaireTitle>What next?</QuestionnaireTitle>
              </QuestionnaireItem>
            </Questionnaire>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      questionnaireItemCompositionRule
    );

    expect(result.status).toBe("pass");
  });

  it("ignores a questionnaire imported from outside the ui alias", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/vendor.tsx",
      `
        import { QuestionnaireItem } from "some-vendor-kit";

        export function Vendor() {
          return <QuestionnaireItem required />;
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      questionnaireItemCompositionRule
    );

    expect(result.status).toBe("not-applicable");
  });

  it("does not apply without a shadcn configuration", async () => {
    const fixture = await createRuleFixture({ react: "19.2.4" });
    fixtures.push(fixture);
    await fixture.write(
      "src/survey.tsx",
      `
        ${IMPORTS}

        export function Survey() {
          return (
            <Questionnaire items={items}>
              <QuestionnaireItem name="task" required />
            </Questionnaire>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      questionnaireItemCompositionRule
    );

    expect(result.status).toBe("not-applicable");
  });

  it("never moves the score while it ships advisory", () => {
    expect(questionnaireItemCompositionRule.maxScore).toBe(0);
  });
});
