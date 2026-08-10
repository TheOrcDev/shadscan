import { afterEach, describe, expect, it } from "vitest";
import { cmdkItemStateVariantsUseValuesRule } from "../src/rules/cmdk-item-state-variants-use-values";
import { createRuleFixture, runRule } from "./rule-fixture";

const fixtures: Awaited<ReturnType<typeof createRuleFixture>>[] = [];

const createCmdkFixture = async (): Promise<
  Awaited<ReturnType<typeof createRuleFixture>>
> => {
  const fixture = await createRuleFixture({
    cmdk: "1.1.1",
    react: "19.2.4",
  });
  fixtures.push(fixture);
  await fixture.write(
    "components.json",
    `${JSON.stringify(
      {
        aliases: { ui: "@/components/ui" },
        style: "new-york",
        tailwind: { css: "src/globals.css" },
      },
      null,
      2
    )}\n`
  );
  return fixture;
};

const writeCommandItem = async (
  fixture: Awaited<ReturnType<typeof createRuleFixture>>,
  className: string,
  children = "Result"
): Promise<void> => {
  await fixture.write(
    "components/ui/command.tsx",
    `
      import { Command as CommandPrimitive } from "cmdk";

      export function CommandItem() {
        return (
          <CommandPrimitive.Item className="${className}">
            ${children}
          </CommandPrimitive.Item>
        );
      }
    `
  );
};

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.cleanup();
  }
});

describe("cmdk-item-state-variants-use-values", () => {
  it("fails bare data-selected variants without a value-aware CSS contract", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(
      fixture,
      "data-selected:bg-muted data-selected:text-foreground"
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
    expect(finding.evidence[0]?.filePath).toContain(
      "components/ui/command.tsx"
    );
  });

  it("passes explicit selected=true arbitrary variants", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(
      fixture,
      "data-[selected=true]:bg-muted data-[selected=true]:text-foreground"
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("pass");
  });

  it("fails an arbitrary selected presence variant", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-[selected]:bg-muted");

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("fails bare data-disabled variants without a value-aware CSS contract", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-disabled:pointer-events-none");

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("fails a module-level presence variant referenced by a cmdk item", async () => {
    const fixture = await createCmdkFixture();
    await fixture.write(
      "components/ui/command.tsx",
      `
        import { Command as CommandPrimitive } from "cmdk";

        const commandItemStyles = "data-selected:bg-muted";

        export function CommandItem() {
          return (
            <CommandPrimitive.Item className={commandItemStyles}>
              Result
            </CommandPrimitive.Item>
          );
        }
      `
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it('passes bare variants when the loaded stylesheet imports "shadcn/tailwind.css"', async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write(
      "src/globals.css",
      '@import "tailwindcss";\n@import "shadcn/tailwind.css";\n'
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("pass");
  });

  it("fails when a local presence variant overrides the shadcn contract", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write(
      "src/globals.css",
      '@import "shadcn/tailwind.css";\n@custom-variant data-selected (&[data-selected]);\n'
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("follows local stylesheet imports to the shadcn variant contract", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write("src/globals.css", '@import "./theme.css";\n');
    await fixture.write("src/theme.css", '@import "shadcn/tailwind.css";\n');

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("pass");
  });

  it("returns an advisory when stylesheet limits prevent contract verification", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    const importIndexes = Array.from({ length: 64 }, (_, index) => index);
    await fixture.write(
      "src/globals.css",
      importIndexes.map((index) => `@import "./theme-${index}.css";`).join("\n")
    );
    for (const index of importIndexes) {
      await fixture.write(
        `src/theme-${index}.css`,
        index === importIndexes.at(-1)
          ? '@import "shadcn/tailwind.css";\n'
          : "@theme inline {}\n"
      );
    }

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("advisory");
  });

  it("ignores safe contracts in stylesheets that are not loaded", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write("src/globals.css", '@import "tailwindcss";\n');
    await fixture.write("src/unused.css", '@import "shadcn/tailwind.css";\n');

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("ignores commented-out shadcn imports", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write(
      "src/globals.css",
      '/* @import "shadcn/tailwind.css"; */\n'
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("ignores a fake shadcn import inside a quoted CSS value", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write(
      "src/globals.css",
      `.example::before {
        content: '@import "shadcn/tailwind.css";';
      }
      `
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("fails a presence-only custom data-selected variant", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write(
      "src/globals.css",
      "@custom-variant data-selected (&[data-selected]);\n"
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("passes an explicit value-aware custom data-selected variant", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write(
      "src/globals.css",
      '@custom-variant data-selected (&[data-selected="true"]);\n'
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("pass");
  });

  it("passes a value-aware block custom variant", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-disabled:pointer-events-none");
    await fixture.write(
      "src/globals.css",
      `@custom-variant data-disabled {
        &:where([data-disabled="true"]),
        &:where([data-disabled]:not([data-disabled="false"])) {
          @slot;
        }
      }
      `
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("pass");
  });

  it("fails a mixed custom variant that also matches attribute presence", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write(
      "src/globals.css",
      '@custom-variant data-selected (&[data-selected="true"], &[data-selected]);\n'
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("fails a custom variant that selects anything except selected=true", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write(
      "src/globals.css",
      '@custom-variant data-selected (&:not([data-selected="true"]));\n'
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("ignores a fake safe custom variant inside a quoted CSS value", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(fixture, "data-selected:bg-muted");
    await fixture.write(
      "src/globals.css",
      `.example::before {
        content: '@custom-variant data-selected (&[data-selected="true"]);';
      }
      `
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("fails a bare selected variant on a named group", async () => {
    const fixture = await createCmdkFixture();
    await writeCommandItem(
      fixture,
      "group/command-item",
      '<span className="group-data-selected/command-item:text-foreground">Shortcut</span>'
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("fails a named-group presence variant in a sibling command shortcut", async () => {
    const fixture = await createCmdkFixture();
    await fixture.write(
      "components/ui/command.tsx",
      `
        import { Command as CommandPrimitive } from "cmdk";

        export function CommandItem() {
          return (
            <CommandPrimitive.Item
              className="group/command-item data-[selected=true]:bg-muted"
            >
              Result
            </CommandPrimitive.Item>
          );
        }

        export function CommandShortcut() {
          return (
            <span className="group-data-selected/command-item:text-foreground">
              Shortcut
            </span>
          );
        }
      `
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("fail");
  });

  it("does not apply to data-selected styling outside cmdk", async () => {
    const fixture = await createCmdkFixture();
    await fixture.write(
      "src/tabs.tsx",
      `
        export function Tab({ selected }: { selected: boolean }) {
          return (
            <div className="data-selected:bg-muted" data-selected={selected}>
              Tab
            </div>
          );
        }
      `
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("not-applicable");
  });

  it("ignores unrelated bare variants co-located with a safe cmdk item", async () => {
    const fixture = await createCmdkFixture();
    await fixture.write(
      "components/ui/command.tsx",
      `
        import { Command as CommandPrimitive } from "cmdk";

        export function CommandItem() {
          return (
            <CommandPrimitive.Item className="data-[selected=true]:bg-muted">
              Result
            </CommandPrimitive.Item>
          );
        }

        export function SelectionBadge({ selected }: { selected: boolean }) {
          return (
            <div className="data-selected:bg-muted" data-selected={selected}>
              Selection
            </div>
          );
        }
      `
    );

    const finding = await runRule(
      fixture.rootDir,
      cmdkItemStateVariantsUseValuesRule
    );

    expect(finding.status).toBe("pass");
  });
});
