import { describe, expect, it } from "vitest";
import { commandMenuPresentRule } from "../src/rules/command-menu-present";
import { createRuleFixture, runRule } from "./rule-fixture";

describe("interaction rules", () => {
  it("requires a complete app-level command menu composition", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "components/command-menu.tsx",
        `
          import { CommandDialog, CommandEmpty, CommandInput, CommandItem } from "@/components/ui/command";
          export function CommandMenu() {
            return <CommandDialog><CommandInput /><CommandEmpty>No results</CommandEmpty><CommandItem>Settings</CommandItem></CommandDialog>;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, commandMenuPresentRule)).status
      ).toBe("pass");

      await fixture.write(
        "components/command-menu.tsx",
        'import { CommandDialog } from "@/components/ui/command"; export function CommandMenu() { return <CommandDialog />; }'
      );
      expect(
        (await runRule(fixture.rootDir, commandMenuPresentRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });
});
