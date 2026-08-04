import { afterEach, describe, expect, it } from "vitest";
import { buttonGroupHoldsOnlyButtonsRule } from "../src/rules/button-group-holds-only-buttons";
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

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.cleanup();
  }
});

describe("button-group-holds-only-buttons", () => {
  it("reports a text input wrapped in a form primitive inside ButtonGroup", async () => {
    // The shape that actually ships: the control is nested one level below the
    // group, so a direct-children scan would miss it.
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/newsletter.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { FormControl } from "@/components/ui/form";
        import { Input } from "@/components/ui/input";

        export function Newsletter() {
          return (
            <ButtonGroup className="w-full">
              <FormControl>
                <Input placeholder="Email" type="email" />
              </FormControl>
              <Button type="submit">Subscribe</Button>
            </ButtonGroup>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("advisory");
    expect(result.evidence?.[0]?.message).toContain(
      "ButtonGroup wraps <Input>"
    );
    expect(result.remediation).toContain("InputGroup");
  });

  it("reports a direct Input child", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/search.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export function Search() {
          return (
            <ButtonGroup>
              <Input placeholder="Search" />
              <Button type="submit">Go</Button>
            </ButtonGroup>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("advisory");
  });

  it("reports a native text input", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/native.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";

        export function Native() {
          return (
            <ButtonGroup>
              <input placeholder="Email" type="email" />
              <Button type="submit">Go</Button>
            </ButtonGroup>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("advisory");
    expect(result.evidence?.[0]?.message).toContain("<input>");
  });

  it("reports a Textarea", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/comment.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Textarea } from "@/components/ui/textarea";

        export function Comment() {
          return (
            <ButtonGroup>
              <Textarea />
              <Button type="submit">Post</Button>
            </ButtonGroup>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("advisory");
  });

  it("passes a segmented control of buttons", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/segmented.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";

        export function Segmented() {
          return (
            <ButtonGroup>
              <Button variant="outline">Day</Button>
              <Button variant="outline">Week</Button>
              <Button variant="outline">Month</Button>
            </ButtonGroup>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("pass");
  });

  it("passes a button group holding non-text controls", async () => {
    // Radios and submit inputs are buttons, not text entry: they carry no
    // offset ring, so the joined shape stays intact.
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/toolbar.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";

        export function Toolbar() {
          return (
            <ButtonGroup>
              <ButtonGroupText>Sort</ButtonGroupText>
              <input type="radio" name="sort" value="new" />
              <Button>Apply</Button>
            </ButtonGroup>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("pass");
  });

  it("ignores an InputGroup composition", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/input-group.tsx",
      `
        import {
          InputGroup,
          InputGroupAddon,
          InputGroupButton,
          InputGroupInput,
        } from "@/components/ui/input-group";

        export function Subscribe() {
          return (
            <InputGroup>
              <InputGroupInput placeholder="Email" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton type="submit">Subscribe</InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("not-applicable");
  });

  it("ignores a ButtonGroup imported from outside the ui alias", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/vendor.tsx",
      `
        import { ButtonGroup } from "some-vendor-kit";
        import { Input } from "@/components/ui/input";

        export function Vendor() {
          return (
            <ButtonGroup>
              <Input placeholder="Email" />
            </ButtonGroup>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("not-applicable");
  });

  it("does not apply without a shadcn configuration", async () => {
    const fixture = await createRuleFixture({ react: "19.2.4" });
    fixtures.push(fixture);
    await fixture.write(
      "src/app.tsx",
      `
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export function App() {
          return (
            <ButtonGroup>
              <Input />
            </ButtonGroup>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("not-applicable");
  });

  it("never moves the score while it ships advisory", () => {
    // Promotion must change maxScore, confidence and the result helper
    // together; a fail() left at confidence "low" is silently downgraded back
    // to advisory, so assert the calibration rather than trusting it.
    expect(buttonGroupHoldsOnlyButtonsRule.maxScore).toBe(0);
  });
});
