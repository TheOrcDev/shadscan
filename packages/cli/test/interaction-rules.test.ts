import { describe, expect, it } from "vitest";
import { commandMenuHotkeyPresentRule } from "../src/rules/command-menu-hotkey-present";
import { commandMenuPresentRule } from "../src/rules/command-menu-present";
import { globalHotkeysAreSafeRule } from "../src/rules/global-hotkeys-are-safe";
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

  it("requires a complete Cmd/Ctrl+K command-menu shortcut", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "components/command-menu.tsx",
        `
          export function CommandMenu() {
            const [open, setOpen] = useState(false);
            useEffect(() => {
              const onKeyDown = (event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                  event.preventDefault();
                  setOpen((current) => !current);
                }
              };
              document.addEventListener("keydown", onKeyDown);
              return () => document.removeEventListener("keydown", onKeyDown);
            }, []);
            return <CommandDialog open={open} />;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, commandMenuHotkeyPresentRule)).status
      ).toBe("pass");

      await fixture.write(
        "components/command-menu.tsx",
        "export function CommandMenu() { return <button onKeyDown={() => setOpen(true)}>Open</button>; }"
      );
      expect(
        (await runRule(fixture.rootDir, commandMenuHotkeyPresentRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects unsafe bare-key global shortcuts", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/hotkeys.tsx",
        `
          useEffect(() => {
            const onKeyDown = (event) => {
              if (event.key === "d") setTheme("dark");
            };
            window.addEventListener("keydown", onKeyDown);
            return () => window.removeEventListener("keydown", onKeyDown);
          }, []);
        `
      );
      expect(
        (await runRule(fixture.rootDir, globalHotkeysAreSafeRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/hotkeys.tsx",
        `
          useEffect(() => {
            const onKeyDown = (event) => {
              if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName) || event.target.isContentEditable) return;
              if (event.key === "d") setTheme("dark");
            };
            window.addEventListener("keydown", onKeyDown);
            return () => window.removeEventListener("keydown", onKeyDown);
          }, []);
        `
      );
      expect(
        (await runRule(fixture.rootDir, globalHotkeysAreSafeRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });
});
