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
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        `
          import { CommandMenu } from "../components/command-menu";
          export function App() { return <CommandMenu />; }
        `
      );
      expect(
        (await runRule(fixture.rootDir, commandMenuPresentRule)).status
      ).toBe("pass");

      await fixture.write(
        "components/command-menu.tsx",
        `
          import { Command, CommandEmpty, CommandInput, CommandItem } from "@/components/ui/command";
          export function Combobox() {
            return <Command><CommandInput /><CommandEmpty>No results</CommandEmpty><CommandItem>Settings</CommandItem></Command>;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, commandMenuPresentRule)).status
      ).toBe("fail");

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
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        `
          import { CommandMenu } from "../components/command-menu";
          export function App() { return <CommandMenu />; }
        `
      );
      const passingResult = await runRule(
        fixture.rootDir,
        commandMenuHotkeyPresentRule
      );
      expect(passingResult.status).toBe("pass");
      expect(passingResult.evidence?.[0]?.line).toBe(6);

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

  it("recognizes a mounted Fumadocs search dialog and its default hotkey", async () => {
    const fixture = await createRuleFixture({
      "fumadocs-ui": "16.0.0",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "components/search.tsx",
        `
          import {
            SearchDialog,
            SearchDialogContent,
            SearchDialogInput,
            SearchDialogList,
          } from "fumadocs-ui/components/dialog/search";

          export default function DefaultSearchDialog(props) {
            return (
              <SearchDialog {...props}>
                <SearchDialogContent>
                  <SearchDialogInput />
                  <SearchDialogList items={[]} />
                </SearchDialogContent>
              </SearchDialog>
            );
          }
        `
      );
      await fixture.write(
        "app/layout.tsx",
        `
          import { RootProvider } from "fumadocs-ui/provider/next";
          import SearchDialog from "@/components/search";
          export default function Layout({ children }) {
            return <RootProvider search={{ SearchDialog }}>{children}</RootProvider>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, commandMenuPresentRule)).status
      ).toBe("pass");
      expect(
        (await runRule(fixture.rootDir, commandMenuHotkeyPresentRule)).status
      ).toBe("pass");

      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <main>{children}</main>; }"
      );

      expect(
        (await runRule(fixture.rootDir, commandMenuPresentRule)).status
      ).toBe("fail");
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
        `
          export function SiteNav() {
            return <nav aria-label="Utility links" className="grid grid-cols-2 sm:grid-cols-5"><a href="/">Home</a><a href="/docs">Docs</a></nav>;
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

  it("recognizes a named always-visible compact primary navigation row", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "components/site-header.tsx",
        `
          const links = [{ href: "/docs", label: "Docs" }, { href: "/scan", label: "Scan" }];
          export function SiteHeader() {
            return (
              <nav aria-label="Primary" className="flex items-center gap-1">
                {links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
              </nav>
            );
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("pass");

      await fixture.write(
        "components/site-header.tsx",
        `
          export function SiteHeader() {
            return (
              <nav aria-label="Primary" className="flex items-center gap-1">
                <a href="/one">One</a>
                <a href="/two">Two</a>
                <a href="/three">Three</a>
                <a href="/four">Four</a>
              </nav>
            );
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("fail");

      await fixture.write(
        "components/site-header.tsx",
        `
          export function SiteHeader({ links }) {
            return (
              <nav aria-label="Primary" className="flex items-center gap-1">
                {links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
              </nav>
            );
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("fail");

      await fixture.write(
        "components/site-header.tsx",
        '<nav aria-label="Primary" className="hidden md:flex"><a href="/docs">Docs</a></nav>'
      );
      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("fail");

      await fixture.write(
        "components/site-header.tsx",
        '<nav aria-label="Utilities" className="flex"><a href="/docs">Docs</a></nav>'
      );
      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("recognizes a mounted responsive shadcn sidebar across app files", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "components/ui/sidebar.tsx",
        `
          export function SidebarProvider({ children }) {
            const isMobile = useIsMobile();
            const [openMobile, setOpenMobile] = useState(false);
            return <div data-mobile={isMobile} data-open={openMobile}>{children}</div>;
          }
          export function Sidebar({ children }) {
            const { isMobile, openMobile, setOpenMobile } = useSidebar();
            return isMobile ? <Sheet open={openMobile} onOpenChange={setOpenMobile}><SheetContent>{children}</SheetContent></Sheet> : <aside>{children}</aside>;
          }
        `
      );
      await fixture.write(
        "app/dashboard/page.tsx",
        `
          import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
          import { DashboardHeader } from "@/components/dashboard-header";
          export default function Page() {
            return <SidebarProvider><Sidebar><a href="/dashboard">Dashboard</a></Sidebar><DashboardHeader /></SidebarProvider>;
          }
        `
      );
      await fixture.write(
        "components/dashboard-header.tsx",
        `
          import { useSidebar } from "@/components/ui/sidebar";
          export function DashboardHeader() {
            const { toggleSidebar } = useSidebar();
            return <button aria-label="Toggle navigation" onClick={toggleSidebar}>Menu</button>;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, mobileNavPresentRule)).status
      ).toBe("pass");

      await fixture.write(
        "components/dashboard-header.tsx",
        "export function DashboardHeader() { return <header>Dashboard</header>; }"
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

      await fixture.write(
        "src/button.tsx",
        `
          export function HoverCardContent({ className }) {
            return <HoverCardPrimitive.Content className={cn("rounded-md outline-none", className)} />;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, focusVisibleNotSuppressedRule)).status
      ).toBe("pass");

      await fixture.write(
        "src/button.tsx",
        `
          export function DialogContent({ className }) {
            return <DialogPrimitive.Popup className={cn("rounded-md outline-none", className)} />;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, focusVisibleNotSuppressedRule)).status
      ).toBe("pass");

      await fixture.write(
        "src/button.tsx",
        `
          export function TabbableDialogContent({ className }) {
            return <DialogPrimitive.Popup tabIndex={0} className={cn("rounded-md outline-none", className)} />;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, focusVisibleNotSuppressedRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });
});
