import { describe, expect, it } from "vitest";
import { customControlsHaveLabelsRule } from "../src/rules/custom-controls-have-labels";
import { htmlLangPresentRule } from "../src/rules/html-lang-present";
import { iframesHaveTitleRule } from "../src/rules/iframes-have-title";
import { imagesHaveAltRule } from "../src/rules/images-have-alt";
import { linksHaveAccessibleNamesRule } from "../src/rules/links-have-accessible-names";
import { navLandmarksHaveNamesRule } from "../src/rules/nav-landmarks-have-names";
import { noNestedInteractiveControlsRule } from "../src/rules/no-nested-interactive-controls";
import { noPositiveTabindexRule } from "../src/rules/no-positive-tabindex";
import { statusMessagesAnnouncedRule } from "../src/rules/status-messages-announced";
import { createRuleFixture, runRule } from "./rule-fixture";

describe("expanded accessibility rules", () => {
  it("requires a language on the owned document shell", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        'export default function Layout({ children }) { return <html lang="en"><body>{children}</body></html>; }'
      );
      expect((await runRule(fixture.rootDir, htmlLangPresentRule)).status).toBe(
        "pass"
      );

      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html><body>{children}</body></html>; }"
      );
      expect((await runRule(fixture.rootDir, htmlLangPresentRule)).status).toBe(
        "fail"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("reads the document language from a Pages Router document", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.6",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "pages/_document.tsx",
        'export default function Document() { return <Html lang="en"><body><Main /></body></Html>; }'
      );

      expect((await runRule(fixture.rootDir, htmlLangPresentRule)).status).toBe(
        "pass"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires alternative text on native and Next images", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Image src="/team.png" />; }'
      );
      expect((await runRule(fixture.rootDir, imagesHaveAltRule)).status).toBe(
        "fail"
      );

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Image src="/team.png" alt={null} />; }'
      );
      expect((await runRule(fixture.rootDir, imagesHaveAltRule)).status).toBe(
        "fail"
      );

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Image src="/team.png" alt="The Acme team" />; }'
      );
      expect((await runRule(fixture.rootDir, imagesHaveAltRule)).status).toBe(
        "pass"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires accessible names on links", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Link href="/settings"><SettingsIcon /></Link>; }'
      );
      expect(
        (await runRule(fixture.rootDir, linksHaveAccessibleNamesRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Link href="/settings">{null}</Link>; }'
      );
      expect(
        (await runRule(fixture.rootDir, linksHaveAccessibleNamesRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App({ label }) { return <Link href="/settings">{label}</Link>; }'
      );
      expect(
        (await runRule(fixture.rootDir, linksHaveAccessibleNamesRule)).status
      ).toBe("advisory");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Link href="/settings">Settings</Link>; }'
      );
      expect(
        (await runRule(fixture.rootDir, linksHaveAccessibleNamesRule)).status
      ).toBe("pass");

      await fixture.write(
        "src/App.tsx",
        `
          function UnrelatedExample() {
            const navLinks = [{ href: "#docs", label: "Docs" }] as const;
            return navLinks.length;
          }
          export function App({ navLinks }) {
            return <nav>{navLinks.map((link) => <Link href={link.href}>{link.label}</Link>)}</nav>;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, linksHaveAccessibleNamesRule)).status
      ).toBe("advisory");

      await fixture.write(
        "src/App.tsx",
        `
          const navLinks = [
            { href: "#compare", label: "Compare" },
            { href: "#themes", label: "Themes" },
          ] as const;
          export function App() {
            return <nav>{navLinks.map((link) => <Link href={link.href}>{link.label}</Link>)}</nav>;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, linksHaveAccessibleNamesRule)).status
      ).toBe("pass");

      await fixture.write(
        "src/App.tsx",
        "export function App() { return null; }"
      );
      await fixture.write(
        "components/ui/pagination.tsx",
        "export function PaginationLink(props) { return <a {...props} />; }"
      );
      expect(
        (await runRule(fixture.rootDir, linksHaveAccessibleNamesRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires accessible labels on custom controls", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/settings.tsx",
        'export function Settings() { return <Switch id="alerts" />; }'
      );
      expect(
        (await runRule(fixture.rootDir, customControlsHaveLabelsRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/settings.tsx",
        'export function Settings() { return <><Label htmlFor="alerts">Alerts</Label><Switch id="alerts" /></>; }'
      );
      expect(
        (await runRule(fixture.rootDir, customControlsHaveLabelsRule)).status
      ).toBe("pass");

      await fixture.write(
        "src/settings.tsx",
        `
          export function Settings({ row }) {
            return <><Label htmlFor={\`\${row.id}-status\`}>Status</Label><SelectTrigger id={\`\${row.id}-status\`} /></>;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, customControlsHaveLabelsRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects positive literal tabIndex values", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        "export function App() { return <button tabIndex={2}>Save</button>; }"
      );
      expect(
        (await runRule(fixture.rootDir, noPositiveTabindexRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        "export function App() { return <button tabIndex={0}>Save</button>; }"
      );
      expect(
        (await runRule(fixture.rootDir, noPositiveTabindexRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires meaningful iframe titles", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        'export function App() { return <iframe src="/report" />; }'
      );
      expect(
        (await runRule(fixture.rootDir, iframesHaveTitleRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <iframe src="/report" title={null} />; }'
      );
      expect(
        (await runRule(fixture.rootDir, iframesHaveTitleRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <iframe src="/report" title="Quarterly report" />; }'
      );
      expect(
        (await runRule(fixture.rootDir, iframesHaveTitleRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires names when multiple navigation landmarks exist", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        "export function App() { return <><nav>Primary</nav><nav>Account</nav></>; }"
      );
      expect(
        (await runRule(fixture.rootDir, navLandmarksHaveNamesRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <><nav aria-label="">Primary</nav><nav aria-label="Account">Account</nav></>; }'
      );
      expect(
        (await runRule(fixture.rootDir, navLandmarksHaveNamesRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <><nav aria-label="Primary">Primary</nav><nav aria-label="Account">Account</nav></>; }'
      );
      expect(
        (await runRule(fixture.rootDir, navLandmarksHaveNamesRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("compares names only for navigation landmarks that can coexist", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          export function App() {
            return <>
              <div className="max-lg:hidden"><NavigationMenu /></div>
              <div className="lg:hidden">
                <nav><a href="/account">Account</a></nav>
              </div>
            </>;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, navLandmarksHaveNamesRule)).status
      ).toBe("pass");

      await fixture.write(
        "src/App.tsx",
        `
          export function App({ navClass }) {
            return <><nav className={navClass}>Primary</nav><nav>Account</nav></>;
          }
        `
      );
      expect(
        (await runRule(fixture.rootDir, navLandmarksHaveNamesRule)).status
      ).toBe("advisory");

      await fixture.write(
        "src/App.tsx",
        "export function App() { return <><NavigationMenu /><NavigationMenu /></>; }"
      );
      expect(
        (await runRule(fixture.rootDir, navLandmarksHaveNamesRule)).status
      ).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects nested interactive controls while allowing asChild", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        'export function App() { return <a href="/"><button>Home</button></a>; }'
      );
      expect(
        (await runRule(fixture.rootDir, noNestedInteractiveControlsRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <button><a href="/" /></button>; }'
      );
      expect(
        (await runRule(fixture.rootDir, noNestedInteractiveControlsRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/App.tsx",
        'export function App() { return <Button asChild><Link href="/">Home</Link></Button>; }'
      );
      expect(
        (await runRule(fixture.rootDir, noNestedInteractiveControlsRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires dynamic status messages to be announced", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/save.tsx",
        'export function Save() { const [statusMessage, setStatus] = useState(""); return <p>{statusMessage}</p>; }'
      );
      expect(
        (await runRule(fixture.rootDir, statusMessagesAnnouncedRule)).status
      ).toBe("fail");

      await fixture.write(
        "src/save.tsx",
        'export function Save() { const [statusMessage, setStatus] = useState(""); return <p role="status">{statusMessage}</p>; }'
      );
      expect(
        (await runRule(fixture.rootDir, statusMessagesAnnouncedRule)).status
      ).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });
});
