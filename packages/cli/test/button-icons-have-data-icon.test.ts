import { afterEach, describe, expect, it } from "vitest";
import { buttonIconsHaveDataIconRule } from "../src/rules/button-icons-have-data-icon";
import { createRuleFixture, runRule } from "./rule-fixture";

const fixtures: Awaited<ReturnType<typeof createRuleFixture>>[] = [];

const createShadcnFixture = async (): Promise<
  Awaited<ReturnType<typeof createRuleFixture>>
> => {
  const fixture = await createRuleFixture({
    "@phosphor-icons/react": "2.1.10",
    react: "19.2.4",
  });
  fixtures.push(fixture);
  await fixture.write("components.json", "{}\n");
  return fixture;
};

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.cleanup();
  }
});

describe("button-icons-have-data-icon", () => {
  it("fails a leading icon without data-icon", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { MagnifyingGlass } from "@phosphor-icons/react";
        import { Button as ActionButton } from "@/components/ui/button";

        export function App() {
          return <ActionButton><MagnifyingGlass />Search</ActionButton>;
        }
      `
    );

    const finding = await runRule(fixture.rootDir, buttonIconsHaveDataIconRule);

    expect(finding.status).toBe("fail");
    expect(finding.evidence[0]?.message).toContain('data-icon="inline-start"');
  });

  it("passes leading, trailing, spinner, and slotted icons", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { ArrowRightIcon, SearchIcon } from "lucide-react";
        import Link from "next/link";
        import { Button } from "@/components/ui/button";
        import { Spinner } from "@/components/ui/spinner";

        export function App() {
          return (
            <>
              <Button><SearchIcon data-icon="inline-start" />Search</Button>
              <Button>Continue<ArrowRightIcon data-icon="inline-end" /></Button>
              <Button><Spinner data-icon="inline-start" />Loading</Button>
              <Button asChild>
                <Link href="/docs">
                  <SearchIcon data-icon="inline-start" />
                  Docs
                </Link>
              </Button>
            </>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, buttonIconsHaveDataIconRule);

    expect(finding.status).toBe("pass");
    expect(finding.evidence[0]?.message).toContain("4 inline");
  });

  it("fails an icon whose data-icon points to the wrong side", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { ArrowRightIcon } from "lucide-react";
        import { Button } from "@/components/ui/button";

        export function App() {
          return <Button>Continue<ArrowRightIcon data-icon="inline-start" /></Button>;
        }
      `
    );

    const finding = await runRule(fixture.rootDir, buttonIconsHaveDataIconRule);

    expect(finding.status).toBe("fail");
    expect(finding.evidence[0]?.message).toContain('expected "inline-end"');
  });

  it("keeps dynamic and spread data-icon values score-neutral", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { SearchIcon } from "lucide-react";
        import { Button } from "@/components/ui/button";

        export function App({ iconProps, placement }) {
          return (
            <>
              <Button><SearchIcon data-icon={placement} />Search</Button>
              <Button><SearchIcon {...iconProps} />Filter</Button>
            </>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, buttonIconsHaveDataIconRule);

    expect(finding.status).toBe("advisory");
    expect(finding.impactsScore).toBe(false);
  });

  it("keeps icon placement with dynamic visible content score-neutral", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { SearchIcon } from "lucide-react";
        import { Button } from "@/components/ui/button";

        export function App({ prefix }) {
          return <Button>{prefix}<SearchIcon />Search</Button>;
        }
      `
    );

    const finding = await runRule(fixture.rootDir, buttonIconsHaveDataIconRule);

    expect(finding.status).toBe("advisory");
    expect(finding.impactsScore).toBe(false);
  });

  it("does not require spacing metadata for icon-only buttons", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { SearchIcon } from "lucide-react";
        import { MoonIcon, SunIcon } from "@phosphor-icons/react";
        import { Button } from "@/components/ui/button";

        export function App() {
          return (
            <>
              <Button aria-label="Search" size="icon"><SearchIcon /></Button>
              <Button size="icon">
                <SunIcon className="hidden dark:block" />
                <MoonIcon className="dark:hidden" />
                <span className="sr-only">Toggle theme</span>
              </Button>
            </>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, buttonIconsHaveDataIconRule);

    expect(finding.status).toBe("not-applicable");
  });

  it("checks labels that become visible at a responsive breakpoint", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { SearchIcon } from "lucide-react";
        import { Button } from "@/components/ui/button";

        export function App() {
          return (
            <Button>
              <SearchIcon />
              <span className="sr-only md:not-sr-only">Search</span>
            </Button>
          );
        }
      `
    );

    const finding = await runRule(fixture.rootDir, buttonIconsHaveDataIconRule);

    expect(finding.status).toBe("fail");
  });

  it("resolves a custom shadcn ui alias with a namespace import", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "components.json",
      '{"aliases":{"ui":"@/design-system"}}\n'
    );
    await fixture.write(
      "src/app.tsx",
      `
        import * as UI from "@/design-system/button";

        export function App() {
          return <UI.Button><svg aria-hidden="true" />Search</UI.Button>;
        }
      `
    );

    const finding = await runRule(fixture.rootDir, buttonIconsHaveDataIconRule);

    expect(finding.status).toBe("fail");
    expect(finding.evidence[0]?.message).toContain("svg inside Button");
  });

  it("ignores Button components that are not imported from shadcn UI", async () => {
    const fixture = await createShadcnFixture();
    await fixture.write(
      "src/app.tsx",
      `
        import { SearchIcon } from "lucide-react";
        import { Button } from "@/features/checkout/button";

        export function App() {
          return <Button><SearchIcon />Search</Button>;
        }
      `
    );

    const finding = await runRule(fixture.rootDir, buttonIconsHaveDataIconRule);

    expect(finding.status).toBe("not-applicable");
  });
});
