import { afterEach, describe, expect, it } from "vitest";
import { runAudit } from "../src/audit";
import { buttonGroupHoldsOnlyButtonsRule } from "../src/rules/button-group-holds-only-buttons";
import { createRuleFixture, runRule } from "./rule-fixture";

const fixtures: Awaited<ReturnType<typeof createRuleFixture>>[] = [];

const CANONICAL_BUTTON_GROUP = `
  export function ButtonGroup(props: { children?: React.ReactNode }) {
    return (
      <div
        className="flex [&>*]:focus-visible:z-10 [&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0"
        data-slot="button-group"
        {...props}
      />
    );
  }

  export function ButtonGroupText(props: { children?: React.ReactNode }) {
    return <div {...props} />;
  }
`;

const SAFE_BUTTON_GROUP = `
  export function ButtonGroup({ children }: { children?: React.ReactNode }) {
    return (
      <div className="flex gap-2" data-slot="button-group">
        {children}
      </div>
    );
  }
`;

const createShadcnFixture = async ({
  buttonGroupSource = CANONICAL_BUTTON_GROUP,
  framework = "next",
  withConfig = true,
}: {
  buttonGroupSource?: string | null;
  framework?: "next" | "vite";
  withConfig?: boolean;
} = {}): Promise<Awaited<ReturnType<typeof createRuleFixture>>> => {
  const fixture = await createRuleFixture({
    react: "19.2.4",
    [framework]: framework === "next" ? "16.2.11" : "7.0.0",
  });
  fixtures.push(fixture);

  if (withConfig) {
    await fixture.write(
      "components.json",
      `${JSON.stringify({ aliases: { ui: "@/components/ui" } }, null, 2)}\n`
    );
  }

  await fixture.write(
    "tsconfig.json",
    `${JSON.stringify(
      {
        compilerOptions: {
          baseUrl: ".",
          jsx: "preserve",
          paths: { "@/*": ["./*"] },
        },
      },
      null,
      2
    )}\n`
  );

  if (buttonGroupSource) {
    await fixture.write("components/ui/button-group.tsx", buttonGroupSource);
  }

  return fixture;
};

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.cleanup();
  }
});

describe("button-group-holds-only-buttons", () => {
  it("fails a ButtonGroup inside a bare react-hook-form Controller", async () => {
    // shadcn's FormField wraps Controller, and plenty of projects use
    // Controller directly. The graph emits no instance for it, because its
    // composition lives in a prop rather than in children.
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Controller, useForm } from "react-hook-form";
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Field, FieldGroup } from "@/components/ui/field";
        import { Input } from "@/components/ui/input";

        export default function Page() {
          const form = useForm();
          return (
            <form>
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="url"
                  render={({ field }) => (
                    <Field>
                      <ButtonGroup>
                        <Input {...field} placeholder="Repo" />
                        <Button type="submit">Go</Button>
                      </ButtonGroup>
                    </Field>
                  )}
                />
              </FieldGroup>
            </form>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("fail");
    expect(result.impactsScore).toBe(true);
  });

  it("sees through a third-party children-transparent provider", async () => {
    // A layout that wraps {children} in an opaque provider used to hide every
    // page below it, and reported the surface as complete while doing so.
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/layout.tsx",
      `
        import { NuqsAdapter } from "nuqs/adapters/next/app";

        export default function Layout({ children }: { children: React.ReactNode }) {
          return (
            <html lang="en">
              <body>
                <NuqsAdapter>{children}</NuqsAdapter>
              </body>
            </html>
          );
        }
      `
    );
    await fixture.write(
      "app/page.tsx",
      `
        import { Suspense } from "react";
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default async function Page() {
          return (
            <Suspense>
              <ButtonGroup>
                <Input placeholder="Email" />
                <Button type="submit">Subscribe</Button>
              </ButtonGroup>
            </Suspense>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("fail");
  });

  it("fails a ButtonGroup returned by a mounted FormField render prop", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
        import { Input } from "@/components/ui/input";

        export default function Newsletter() {
          return (
            <Form>
              <form>
                <FormField
                  name="email"
                  render={() => (
                    <FormItem>
                      <FormControl>
                        <ButtonGroup>
                          <Input placeholder="Email" type="email" />
                          <Button type="submit">Subscribe</Button>
                        </ButtonGroup>
                      </FormControl>
                    </FormItem>
                  )}
                />
              </form>
            </Form>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("fail");
    expect(result.evidence[0]).toMatchObject({
      filePath: expect.stringContaining("app/page.tsx"),
      line: 17,
    });
  });

  it("fails a rendered text input projected through FormControl", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { FormControl } from "@/components/ui/form";
        import { Input } from "@/components/ui/input";

        export default function Newsletter() {
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

    expect(result.status).toBe("fail");
    expect(result.impactsScore).toBe(true);
    expect(result.maxScore).toBe(2);
    expect(result.evidence[0]?.message).toContain("ButtonGroup joins <Input>");
    expect(result.remediation).toContain("InputGroup");
  });

  it("fails a rendered direct Input child", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function Search() {
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

    expect(result.status).toBe("fail");
  });

  it("fails the same rendered composition from a Vite entry", async () => {
    const fixture = await createShadcnFixture({ framework: "vite" });
    await fixture.write(
      "src/root.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function Root() {
          return (
            <ButtonGroup>
              <Input placeholder="Search" />
              <Button type="submit">Go</Button>
            </ButtonGroup>
          );
        }
      `
    );
    await fixture.write(
      "src/main.tsx",
      `
        import { createRoot } from "react-dom/client";
        import Root from "./root";

        createRoot(document.getElementById("root")).render(<Root />);
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("fail");
  });

  it("fails a text input projected through a Radix Slot", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Slot } from "@radix-ui/react-slot";
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function Search() {
          return (
            <ButtonGroup>
              <Slot>
                <Input placeholder="Search" />
              </Slot>
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

    expect(result.status).toBe("fail");
  });

  it("fails a rendered native text input", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";

        export default function Native() {
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

    expect(result.status).toBe("fail");
    expect(result.evidence[0]?.message).toContain("<input>");
  });

  it("fails a rendered Textarea", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Textarea } from "@/components/ui/textarea";

        export default function Comment() {
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

    expect(result.status).toBe("fail");
  });

  it("passes a rendered segmented control of buttons", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";

        export default function Segmented() {
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

  it("passes rendered non-text input controls", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";

        export default function Toolbar() {
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

  it("does not apply to an InputGroup composition", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import {
          InputGroup,
          InputGroupAddon,
          InputGroupButton,
          InputGroupInput,
        } from "@/components/ui/input-group";

        export default function Subscribe() {
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

  it("does not apply to a vendor ButtonGroup", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { ButtonGroup } from "some-vendor-kit";
        import { Input } from "@/components/ui/input";

        export default function Vendor() {
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
    const fixture = await createShadcnFixture({ withConfig: false });
    await fixture.write(
      "app/page.tsx",
      `
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function App() {
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

  it("passes a lone rendered text control", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function Lone() {
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

    expect(result.status).toBe("pass");
  });

  it("fails when a sibling can render conditionally with the input", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function Conditional({ loading }: { loading: boolean }) {
          return (
            <ButtonGroup>
              <Input placeholder="Email" />
              {loading ? <span>…</span> : <Button>Go</Button>}
            </ButtonGroup>
          );
        }
      `
    );

    const result = await runRule(
      fixture.rootDir,
      buttonGroupHoldsOnlyButtonsRule
    );

    expect(result.status).toBe("fail");
  });

  it("passes text controls and siblings in mutually exclusive branches", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function Exclusive({ editing }: { editing: boolean }) {
          return (
            <ButtonGroup>
              {editing ? <Input placeholder="Email" /> : <Button>Edit</Button>}
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

  it("passes separately written branches that cannot coexist", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function Exclusive({ editing }: { editing: boolean }) {
          return (
            <ButtonGroup>
              {editing && <Input placeholder="Email" />}
              {!editing && <Button>Edit</Button>}
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

  it("ignores text controls inside a portalled UI descendant", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";
        import { PopoverContent } from "@/components/ui/popover";

        export default function PopoverSearch() {
          return (
            <ButtonGroup>
              <Button>Filters</Button>
              <PopoverContent>
                <Input placeholder="Filter options" />
              </PopoverContent>
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

  it("ignores an unmounted demo containing the violation", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      "export default function Page() { return <main>Home</main>; }"
    );
    await fixture.write(
      "src/unused-demo.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export function UnusedDemo() {
          return (
            <ButtonGroup>
              <Input placeholder="Search" />
              <Button>Go</Button>
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

  it("keeps an unresolved potentially transparent wrapper advisory", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        const DynamicWrapper = ({ children }: { children: React.ReactNode }) => children;

        export default function WrappedSearch() {
          return (
            <ButtonGroup>
              <DynamicWrapper>
                <Input placeholder="Search" />
              </DynamicWrapper>
              <Button>Go</Button>
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
    expect(result.impactsScore).toBe(false);
  });

  it("keeps a dynamic input type advisory", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function DynamicType({ type }: { type: string }) {
          return (
            <ButtonGroup>
              <Input type={type} />
              <Button>Go</Button>
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
    expect(result.impactsScore).toBe(false);
  });

  it("keeps an unresolved ButtonGroup implementation advisory", async () => {
    const fixture = await createShadcnFixture({ buttonGroupSource: null });
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function Search() {
          return (
            <ButtonGroup>
              <Input />
              <Button>Go</Button>
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

  it("passes a customized ButtonGroup that does not join its children", async () => {
    const fixture = await createShadcnFixture({
      buttonGroupSource: SAFE_BUTTON_GROUP,
    });
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function Search() {
          return (
            <ButtonGroup>
              <Input />
              <Button>Go</Button>
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

  it("creates a P2 fix with a two-point raw score impact", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "app/page.tsx",
      `
        import { Button } from "@/components/ui/button";
        import { ButtonGroup } from "@/components/ui/button-group";
        import { Input } from "@/components/ui/input";

        export default function Search() {
          return (
            <ButtonGroup>
              <Input />
              <Button>Go</Button>
            </ButtonGroup>
          );
        }
      `
    );

    const report = await runAudit(fixture.rootDir, {
      rules: [buttonGroupHoldsOnlyButtonsRule],
    });
    const actionable = report.agentHandoff.actionables[0];

    expect(actionable).toMatchObject({
      disposition: "fix",
      findingId: "button-group-holds-only-buttons",
      priority: "P2",
      scoreImpact: 2,
      status: "fail",
    });
    expect(buttonGroupHoldsOnlyButtonsRule.maxScore).toBe(2);
  });
});
