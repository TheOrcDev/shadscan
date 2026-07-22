import { afterEach, describe, expect, it } from "vitest";
import { alertAnatomyRule } from "../src/rules/alert-anatomy";
import { inputGroupCompositionRule } from "../src/rules/input-group-composition";
import { itemsBelongToGroupsRule } from "../src/rules/items-belong-to-groups";
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

describe("items-belong-to-groups", () => {
  it("passes items composed inside their groups", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import {
          Select,
          SelectContent,
          SelectGroup,
          SelectItem,
        } from "@/components/ui/select";

        export function App() {
          return (
            <Select>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="a">A</SelectItem>
                  <SelectItem value="b">B</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, itemsBelongToGroupsRule);

    expect(finding.status).toBe("pass");
    expect(finding.evidence[0]?.message).toContain("2 statically provable");
  });

  it("reports an item placed directly inside its content context", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import {
          DropdownMenu,
          DropdownMenuContent,
          DropdownMenuItem,
        } from "@/components/ui/dropdown-menu";

        export function App() {
          return (
            <DropdownMenu>
              <DropdownMenuContent>
                <DropdownMenuItem>Profile</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, itemsBelongToGroupsRule);

    expect(finding.status).toBe("advisory");
    expect(finding.evidence[0]?.message).toContain("DropdownMenuItem");
    expect(finding.evidence[0]?.message).toContain("DropdownMenuGroup");
  });

  it("reports command items outside command groups", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import {
          Command,
          CommandItem,
          CommandList,
        } from "@/components/ui/command";

        export function App() {
          return (
            <Command>
              <CommandList>
                <CommandItem>Docs</CommandItem>
              </CommandList>
            </Command>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, itemsBelongToGroupsRule);

    expect(finding.status).toBe("advisory");
    expect(finding.evidence[0]?.message).toContain("CommandItem");
  });

  it("stays uncertain when composition crosses component boundaries", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { SelectItem } from "@/components/ui/select";

        export function CountryOption({ code }: { code: string }) {
          return <SelectItem value={code}>{code}</SelectItem>;
        }
      `
    );

    const finding = await runRule(fixture.rootDir, itemsBelongToGroupsRule);

    expect(finding.status).toBe("not-applicable");
    expect(finding.evidence[0]?.message).toContain("component boundaries");
  });

  it("respects import aliases when resolving items", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import {
          SelectContent as Content,
          SelectItem as Option,
        } from "@/components/ui/select";

        export function App() {
          return (
            <Content>
              <Option value="a">A</Option>
            </Content>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, itemsBelongToGroupsRule);

    expect(finding.status).toBe("advisory");
    expect(finding.evidence[0]?.message).toContain("SelectItem");
  });
});

describe("input-group-composition", () => {
  it("passes an InputGroup composed from its own parts", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import {
          InputGroup,
          InputGroupAddon,
          InputGroupInput,
        } from "@/components/ui/input-group";

        export function App() {
          return (
            <InputGroup>
              <InputGroupInput placeholder="Search" />
              <InputGroupAddon align="inline-end">Go</InputGroupAddon>
            </InputGroup>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, inputGroupCompositionRule);

    expect(finding.status).toBe("pass");
    expect(finding.evidence[0]?.message).toContain("1 InputGroup");
  });

  it("reports a raw Input inside InputGroup", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { Input } from "@/components/ui/input";
        import { InputGroup } from "@/components/ui/input-group";

        export function App() {
          return (
            <InputGroup>
              <Input placeholder="Search" />
            </InputGroup>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, inputGroupCompositionRule);

    expect(finding.status).toBe("advisory");
    expect(finding.evidence[0]?.message).toContain("Input");
    expect(finding.remediation).toContain("InputGroupInput");
  });

  it("reports a raw Button inside InputGroup", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { Button } from "@/components/ui/button";
        import {
          InputGroup,
          InputGroupInput,
        } from "@/components/ui/input-group";

        export function App() {
          return (
            <InputGroup>
              <InputGroupInput placeholder="Search" />
              <Button type="submit">Go</Button>
            </InputGroup>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, inputGroupCompositionRule);

    expect(finding.status).toBe("advisory");
    expect(finding.remediation).toContain("InputGroupAddon");
  });

  it("reports a native input inside InputGroup", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { InputGroup } from "@/components/ui/input-group";

        export function App() {
          return (
            <InputGroup>
              <input placeholder="Search" />
            </InputGroup>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, inputGroupCompositionRule);

    expect(finding.status).toBe("advisory");
    expect(finding.evidence[0]?.message).toContain("native input");
  });
});

describe("alert-anatomy", () => {
  it("passes an Alert with icon, title, and description", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { WarningIcon } from "@phosphor-icons/react";
        import {
          Alert,
          AlertDescription,
          AlertTitle,
        } from "@/components/ui/alert";

        export function App() {
          return (
            <Alert>
              <WarningIcon />
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>Something needs attention.</AlertDescription>
            </Alert>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, alertAnatomyRule);

    expect(finding.status).toBe("pass");
  });

  it("reports an Alert missing its title", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { Alert, AlertDescription } from "@/components/ui/alert";

        export function App() {
          return (
            <Alert>
              <AlertDescription>Something happened.</AlertDescription>
            </Alert>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, alertAnatomyRule);

    expect(finding.status).toBe("advisory");
    expect(finding.evidence[0]?.message).toContain("AlertTitle");
  });

  it("reports more than one icon inside an Alert", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { BellIcon, WarningIcon } from "@phosphor-icons/react";
        import { Alert, AlertTitle } from "@/components/ui/alert";

        export function App() {
          return (
            <Alert>
              <WarningIcon />
              <BellIcon />
              <AlertTitle>Noisy</AlertTitle>
            </Alert>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, alertAnatomyRule);

    expect(finding.status).toBe("advisory");
    expect(finding.evidence[0]?.message).toContain("2 icons");
  });

  it("accepts project-defined anatomy extensions", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "components/ui/alert.tsx",
      `
        export function Alert(props: { children?: unknown }) {
          return <div role="alert">{props.children}</div>;
        }
        export function AlertTitle(props: { children?: unknown }) {
          return <h5>{props.children}</h5>;
        }
        export function AlertBadge(props: { children?: unknown }) {
          return <span>{props.children}</span>;
        }
      `
    );
    await fixture.write(
      "src/app.tsx",
      `
        import { Alert, AlertTitle } from "@/components/ui/alert";
        import { AlertBadge } from "@/components/ui/alert";

        export function App() {
          return (
            <Alert>
              <AlertTitle>Custom</AlertTitle>
              <AlertBadge>New</AlertBadge>
            </Alert>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, alertAnatomyRule);

    expect(finding.status).toBe("pass");
  });

  it("reports foreign children when the module exports are known", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "components/ui/alert.tsx",
      `
        export function Alert(props: { children?: unknown }) {
          return <div role="alert">{props.children}</div>;
        }
        export function AlertTitle(props: { children?: unknown }) {
          return <h5>{props.children}</h5>;
        }
      `
    );
    await fixture.write(
      "src/app.tsx",
      `
        import { Alert, AlertTitle } from "@/components/ui/alert";
        import { Badge } from "@/components/ui/badge";

        export function App() {
          return (
            <Alert>
              <AlertTitle>Mixed</AlertTitle>
              <Badge>New</Badge>
            </Alert>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, alertAnatomyRule);

    expect(finding.status).toBe("advisory");
    expect(finding.evidence[0]?.message).toContain("Badge");
  });

  it("stays quiet when Alert children are dynamic", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { Alert } from "@/components/ui/alert";

        export function App({ children }: { children: React.ReactNode }) {
          return <Alert>{children}</Alert>;
        }
      `
    );

    const finding = await runRule(fixture.rootDir, alertAnatomyRule);

    expect(finding.status).toBe("not-applicable");
    expect(finding.evidence[0]?.message).toContain("dynamic");
  });
});
