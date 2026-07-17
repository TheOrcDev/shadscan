import { describe, expect, it } from "vitest";
import type { AuditRule } from "../src/audit";
import { asyncActionPendingStateRule } from "../src/rules/async-action-pending-state";
import { commandMenuHotkeyPresentRule } from "../src/rules/command-menu-hotkey-present";
import { fieldErrorsRenderedRule } from "../src/rules/field-errors-rendered";
import { focusVisibleNotSuppressedRule } from "../src/rules/focus-visible-not-suppressed";
import { globalHotkeysAreSafeRule } from "../src/rules/global-hotkeys-are-safe";
import { highConfidenceRules } from "../src/rules/high-confidence";
import { mobileNavPresentRule } from "../src/rules/mobile-nav-present";
import { statusMessagesAnnouncedRule } from "../src/rules/status-messages-announced";
import { validationWiredToFormRule } from "../src/rules/validation-wired-to-form";
import { createRuleFixture, runRule } from "./rule-fixture";

const getHighConfidenceRule = (id: string): AuditRule => {
  const rule = highConfidenceRules.find((candidate) => candidate.id === id);

  if (!rule) {
    throw new Error(`Missing high-confidence rule: ${id}`);
  }

  return rule;
};

describe("feature-local evidence", () => {
  it("does not borrow form, state, or navigation evidence from another component", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/surfaces.tsx",
        `
          export function BrokenAsync() {
            const [state, action] = useActionState(save, null);
            return <form action={action}><button>Save</button></form>;
          }

          export function UnrelatedPending() {
            const pending = true;
            return <button disabled={pending}>{pending ? <Spinner /> : "Save"}</button>;
          }

          export function BrokenForm() {
            return <form><input name="email" /></form>;
          }

          export function UnrelatedValidation() {
            schema.safeParse({ email: "person@example.com" });
            return <div />;
          }

          export function BrokenErrors() {
            const form = useForm();
            return <form />;
          }

          export function UnrelatedErrorUi() {
            return <FormMessage />;
          }

          export function BrokenStatus() {
            setStatus("Saved");
            return <p>Saved</p>;
          }

          export function UnrelatedLiveRegion() {
            return <p role="status">Ready</p>;
          }

          export function DesktopNavigation() {
            return <nav>Desktop links</nav>;
          }

          export function UnrelatedMobilePanel() {
            return <div className="md:hidden"><SheetTrigger /><SheetContent /></div>;
          }
        `
      );

      const rules = [
        asyncActionPendingStateRule,
        validationWiredToFormRule,
        fieldErrorsRenderedRule,
        statusMessagesAnnouncedRule,
        mobileNavPresentRule,
      ];

      for (const rule of rules) {
        expect((await runRule(fixture.rootDir, rule)).status).toBe("fail");
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps shortcut evidence in one owner and checks every bare-key branch", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/hotkeys.tsx",
        `
          export function IncompleteCommandShortcut() {
            useEffect(() => {
              function onKeyDown(event) {
                if ((event.metaKey || event.ctrlKey) && event.key === "k") return;
              }
              document.addEventListener("keydown", onKeyDown);
              return () => document.removeEventListener("keydown", onKeyDown);
            }, []);
            return <CommandDialog />;
          }

          export function UnrelatedCommandAction() {
            event.preventDefault();
            setOpen(true);
            return <div />;
          }

          export function IncompleteThemeShortcut() {
            useEffect(() => {
              function onKeyDown(event) {
                if (event.key === "d") return;
              }
              window.addEventListener("keydown", onKeyDown);
              return () => window.removeEventListener("keydown", onKeyDown);
            }, []);
            return <div />;
          }

          export function UnrelatedThemeAction() {
            if (event.target.tagName === "INPUT") return null;
            setTheme("dark");
            return <div />;
          }

          export function MixedShortcutBranches() {
            useEffect(() => {
              function onKeyDown(event) {
                if ((event.metaKey || event.ctrlKey) && event.key === "k") {
                  openCommandMenu();
                }
                if (event.key === "d") setTheme("dark");
              }
              window.addEventListener("keydown", onKeyDown);
              return () => window.removeEventListener("keydown", onKeyDown);
            }, []);
            return <div />;
          }
        `
      );

      expect(
        (await runRule(fixture.rootDir, commandMenuHotkeyPresentRule)).status
      ).toBe("fail");
      expect(
        (
          await runRule(
            fixture.rootDir,
            getHighConfidenceRule("theme-hotkey-present")
          )
        ).status
      ).toBe("fail");
      expect(
        (await runRule(fixture.rootDir, globalHotkeysAreSafeRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires a focus replacement for the selector that removed it", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/globals.css",
        `
          .button:focus { outline: none; }
          .link:focus-visible { box-shadow: 0 0 0 2px currentColor; }
        `
      );

      expect(
        (await runRule(fixture.rootDir, focusVisibleNotSuppressedRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/globals.css",
        `
          .button:focus { outline: none; }
          .button:focus-visible { box-shadow: 0 0 0 2px currentColor; }
        `
      );

      expect(
        (await runRule(fixture.rootDir, focusVisibleNotSuppressedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });
});
