import { describe, expect, it } from "vitest";
import { commandMenuHotkeyPresentRule } from "../src/rules/command-menu-hotkey-present";
import { commandMenuPresentRule } from "../src/rules/command-menu-present";
import { focusVisibleNotSuppressedRule } from "../src/rules/focus-visible-not-suppressed";
import { globalHotkeysAreSafeRule } from "../src/rules/global-hotkeys-are-safe";
import { mobileNavPresentRule } from "../src/rules/mobile-nav-present";
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

  it("requires mobile navigation when app-level navigation exists", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "components/site-nav.tsx",
        `
          export function SiteNav() {
            return <><nav className="hidden md:flex">Desktop</nav><Sheet><SheetTrigger className="md:hidden" aria-label="Open navigation"><Menu /></SheetTrigger><SheetContent>Mobile</SheetContent></Sheet></>;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("pass");

      await fixture.write(
        "components/site-nav.tsx",
        'export function SiteNav() { return <nav><a href="/">Home</a></nav>; }'
      );
      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects outline suppression without a visible replacement", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/button.tsx",
        'export function Button() { return <button className="outline-none px-2">Save</button>; }'
      );
      expect(
        (await runRule(fixture.rootDir, focusVisibleNotSuppressedRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/button.tsx",
        'export function Button() { return <button className="outline-none focus-visible:ring-2 px-2">Save</button>; }'
      );
      expect(
        (await runRule(fixture.rootDir, focusVisibleNotSuppressedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });
});
