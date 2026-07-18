import { describe, expect, it } from "vitest";
import { commandMenuHotkeyPresentRule } from "../src/rules/command-menu-hotkey-present";
import { commandMenuPresentRule } from "../src/rules/command-menu-present";
import { focusVisibleNotSuppressedRule } from "../src/rules/focus-visible-not-suppressed";
import { globalHotkeysAreSafeRule } from "../src/rules/global-hotkeys-are-safe";
import { mobileNavPresentRule } from "../src/rules/mobile-nav-present";
import {
  getResponsiveVisibilityFromClassNames,
  isSmallScreenVisibility,
  responsiveVisibilitiesOverlap,
} from "../src/rules/responsive-visibility";
import { createRuleFixture, runRule } from "./rule-fixture";

describe("interaction rules", () => {
  it("models a bounded set of responsive display classes", () => {
    const overlapCases: [string[] | null, string[], boolean | null][] = [
      [["hidden", "lg:flex"], ["lg:hidden"], false],
      [["max-lg:hidden"], ["lg:hidden"], false],
      [["md:hidden"], ["lg:hidden"], true],
      [[], ["lg:hidden"], true],
      [null, ["lg:hidden"], null],
    ];

    for (const [leftClasses, rightClasses, expected] of overlapCases) {
      const left = getResponsiveVisibilityFromClassNames(leftClasses);
      const right = getResponsiveVisibilityFromClassNames(rightClasses);
      expect(responsiveVisibilitiesOverlap(left, right)).toBe(expected);
    }

    expect(
      isSmallScreenVisibility(
        getResponsiveVisibilityFromClassNames(["lg:hidden"])
      )
    ).toBe(true);
    expect(
      isSmallScreenVisibility(
        getResponsiveVisibilityFromClassNames(["hidden", "lg:flex"])
      )
    ).toBe(false);
    expect(
      isSmallScreenVisibility(getResponsiveVisibilityFromClassNames(null))
    ).toBe(false);
  });

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

      await fixture.write(
        "src/hotkeys.tsx",
        `
          function isTypingTarget(target: EventTarget | null) {
            if (!(target instanceof HTMLElement)) return false;
            return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
          }

          useEffect(() => {
            const onKeyDown = (event) => {
              if (event.key.toLowerCase() !== "d") return;
              if (isTypingTarget(event.target)) return;
              setTheme("dark");
            };
            window.addEventListener("keydown", onKeyDown);
            return () => window.removeEventListener("keydown", onKeyDown);
          }, []);
        `
      );
      expect(
        (await runRule(fixture.rootDir, globalHotkeysAreSafeRule)).status
      ).toBe("pass");

      await fixture.write(
        "src/hotkeys.tsx",
        `
          function isTypingTarget() {
            return false;
          }

          useEffect(() => {
            const onKeyDown = (event) => {
              if (event.key === "d" && !isTypingTarget(event.target)) setTheme("dark");
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
          function isTypingTarget(target: EventTarget | null) {
            return target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
          }

          useEffect(() => {
            const onKeyDown = (event) => {
              if (isTypingTarget(event.target) && event.shiftKey) return;
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

  it("recognizes correlated state-controlled mobile navigation", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "components/site-nav.tsx",
        `
          export function SiteNav() {
            const [isMenuOpen, setIsMenuOpen] = useState(false);
            return (
              <>
                <NavigationMenu className="max-lg:hidden" />
                <Button
                  className="lg:hidden"
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                >
                  <span className="sr-only">Open main menu</span>
                </Button>
                <div className={cn("lg:hidden", isMenuOpen ? "visible" : "invisible")}>
                  <nav><a href="/one">One</a></nav>
                </div>
              </>
            );
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects disconnected or incomplete custom mobile navigation", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "components/site-nav.tsx",
        `
          export function SiteNav() {
            const [isMenuOpen, setIsMenuOpen] = useState(false);
            const [isOtherOpen, setIsOtherOpen] = useState(false);
            return <>
              <nav className="max-lg:hidden"><a href="/">Home</a></nav>
              <button className="lg:hidden" aria-label="Open menu" onClick={() => setIsOtherOpen(!isOtherOpen)} />
              <div className={cn("lg:hidden", isMenuOpen ? "block" : "hidden")}>
                <nav><a href="/one">One</a></nav>
              </div>
            </>;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("fail");

      await fixture.write(
        "components/site-nav.tsx",
        `
          export function SiteNav() {
            const [isMenuOpen, setIsMenuOpen] = useState(false);
            return <>
              <nav className="max-lg:hidden"><a href="/">Home</a></nav>
              <button className="lg:hidden" aria-label="Open menu" onClick={() => setIsMenuOpen(!isMenuOpen)} />
              <div className={cn("lg:hidden", isMenuOpen ? "block" : "hidden")}><p>No links</p></div>
            </>;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("fail");

      await fixture.write(
        "components/site-nav.tsx",
        `
          export function SiteNav() {
            const [isMenuOpen, setIsMenuOpen] = useState(false);
            return <>
              <nav><a href="/">Home</a></nav>
              <button aria-label="Open menu" onClick={() => setIsMenuOpen(!isMenuOpen)} />
              <div className={isMenuOpen ? "block" : "hidden"}><nav><a href="/one">One</a></nav></div>
            </>;
          }
        `
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
