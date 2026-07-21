import { describe, expect, it } from "vitest";
import { buildComponentRenderGraph } from "../src/component-render-graph";
import { discoverProject } from "../src/discovery";
import {
  evaluateNavigationRenderGraph,
  navLandmarksHaveNamesRule,
} from "../src/rules/nav-landmarks-have-names";
import { createRuleFixture, runRule } from "./rule-fixture";

const runNavRule = (rootDir: string) =>
  runRule(rootDir, navLandmarksHaveNamesRule);

describe("navigation render surfaces", () => {
  it("fails when imported child landmarks render together without names", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/navigation.tsx",
        `
          export function PrimaryNav() { return <nav>Primary</nav>; }
          export function UtilityNav() { return <nav>Utility</nav>; }
        `
      );
      await fixture.write(
        "src/App.tsx",
        `
          import { PrimaryNav, UtilityNav } from "./navigation";
          export function App() { return <><PrimaryNav /><UtilityNav /></>; }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("passes when imported child landmarks have distinct names", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/navigation.tsx",
        `
          export function PrimaryNav() { return <nav aria-label="Primary" />; }
          export function UtilityNav() { return <nav aria-label="Utility" />; }
        `
      );
      await fixture.write(
        "src/App.tsx",
        `
          import { PrimaryNav, UtilityNav } from "./navigation";
          export function App() { return <><PrimaryNav /><UtilityNav /></>; }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("ignores unrelated opaque third-party components", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          import AnalyticsWidget from "analytics-widget";
          export function App() {
            return <><nav aria-label="Primary" /><AnalyticsWidget /></>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("detects the same landmark component rendered twice", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/Nav.tsx",
        "export function Nav() { return <NavigationMenu />; }"
      );
      await fixture.write(
        "src/App.tsx",
        'import { Nav } from "./Nav"; export function App() { return <><Nav /><Nav /></>; }'
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not compare mutually exclusive component branches", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/Nav.tsx",
        "export function Nav() { return <NavigationMenu />; }"
      );
      await fixture.write(
        "src/App.tsx",
        'import { Nav } from "./Nav"; export function App({ alternate }) { return alternate ? <Nav /> : <Nav />; }'
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns advisory for unknown iteration multiplicity", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          export function App({ items }) {
            return <main>{items.map((item) => <nav key={item.id}>{item.name}</nav>)}</main>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns advisory for navigation-relevant component-valued props", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          export function App({ Navigation }) {
            return <><nav aria-label="Primary" /><Navigation /></>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns advisory for render props and unsupported control flow", async () => {
    const renderPropFixture = await createRuleFixture();
    const switchFixture = await createRuleFixture();

    try {
      await renderPropFixture.write(
        "src/App.tsx",
        `
          function Shell() { return <main />; }
          export function App() {
            return <Shell renderNavigation={() => <nav aria-label="Primary" />} />;
          }
        `
      );
      await switchFixture.write(
        "src/App.tsx",
        `
          export function App({ mode }) {
            switch (mode) {
              case "primary": return <NavigationMenu />;
              default: return <NavigationMenu />;
            }
          }
        `
      );

      expect((await runNavRule(renderPropFixture.rootDir)).status).toBe(
        "advisory"
      );
      expect((await runNavRule(switchFixture.rootDir)).status).toBe("advisory");
    } finally {
      await Promise.all([renderPropFixture.cleanup(), switchFixture.cleanup()]);
    }
  });

  it("combines responsive visibility across component boundaries", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/Nav.tsx",
        'export function Nav() { return <nav aria-label="Primary" />; }'
      );
      await fixture.write(
        "src/App.tsx",
        `
          import { Nav } from "./Nav";
          export function App() {
            return <><div className="max-lg:hidden"><Nav /></div><div className="lg:hidden"><Nav /></div></>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("ignores exported navigation components not reachable from the root", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/UnusedNav.tsx",
        "export function UnusedNav() { return <><nav /><nav /></>; }"
      );
      await fixture.write(
        "src/App.tsx",
        "export function App() { return <main>Home</main>; }"
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not compare landmarks from separate App Router pages", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html><body>{children}</body></html>; }"
      );
      await fixture.write(
        "app/page.tsx",
        "export default function Home() { return <NavigationMenu />; }"
      );
      await fixture.write(
        "app/about/page.tsx",
        "export default function About() { return <NavigationMenu />; }"
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("compares App Router layouts with their descendant pages", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        `
          function Provider({ children }) { return <section>{children}</section>; }
          export default function Layout({ children }) {
            return <html><body><NavigationMenu /><Provider>{children}</Provider></body></html>;
          }
        `
      );
      await fixture.write(
        "app/page.tsx",
        "export default function Home() { return <NavigationMenu />; }"
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps App and Pages Router trees in separate hybrid surfaces", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html><body><NavigationMenu />{children}</body></html>; }"
      );
      await fixture.write(
        "app/page.tsx",
        "export default function Home() { return <main>App route</main>; }"
      );
      await fixture.write(
        "pages/_app.tsx",
        "export default function App({ Component, pageProps }) { return <><NavigationMenu /><Component {...pageProps} /></>; }"
      );
      await fixture.write(
        "pages/index.tsx",
        "export default function Home() { return <main>Pages route</main>; }"
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not compare sequential early-return branches", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          export function App({ mobile }) {
            if (mobile) return <NavigationMenu />;
            return <NavigationMenu />;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns advisory when caller children projection is unknown", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Shell(props) {
            const { children } = props;
            return <main>{children}</main>;
          }
          export function App() {
            return <><nav aria-label="Primary" /><Shell><nav aria-label="Utility" /></Shell></>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns advisory for map composition through an imported Sidebar", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/Sidebar.tsx",
        'export function Sidebar() { return <nav aria-label="Sidebar" />; }'
      );
      await fixture.write(
        "src/App.tsx",
        `
          import { Sidebar } from "./Sidebar";
          export function App({ items }) { return <main>{items.map(() => <Sidebar />)}</main>; }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not trust responsive classes on components that ignore className", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Nav() { return <nav aria-label="Primary" />; }
          export function App() {
            return <><Nav className="max-lg:hidden" /><Nav className="lg:hidden" /></>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("uses responsive classes when className forwarding is proven", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Nav({ className }) { return <nav aria-label="Primary" className={className} />; }
          export function App() {
            return <><Nav className="max-lg:hidden" /><Nav className="lg:hidden" /></>;
          }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not double count a resolved local NavigationMenu proxy", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function NavigationMenu() { return <nav aria-label="Main" />; }
          export function App() { return <NavigationMenu />; }
        `
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("compares client wrapper children and multiple mounts in one document", async () => {
    const wrapperFixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });
    const rootsFixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });

    try {
      await wrapperFixture.write(
        "src/components.tsx",
        `
          export function Shell({ children }) { return <><NavigationMenu />{children}</>; }
          export function App() { return <NavigationMenu />; }
        `
      );
      await wrapperFixture.write(
        "src/main.tsx",
        `
          import { createRoot } from "react-dom/client";
          import { App, Shell } from "./components";
          createRoot(document.getElementById("root")).render(<Shell><App /></Shell>);
        `
      );
      await rootsFixture.write(
        "src/components.tsx",
        `
          export function Primary() { return <NavigationMenu />; }
          export function Utility() { return <NavigationMenu />; }
        `
      );
      await rootsFixture.write(
        "src/main.tsx",
        `
          import { createRoot } from "react-dom/client";
          import { Primary, Utility } from "./components";
          const primaryRoot = createRoot(document.getElementById("primary"));
          const utilityRoot = createRoot(document.getElementById("utility"));
          primaryRoot.render(<Primary />);
          utilityRoot.render(<Utility />);
        `
      );

      expect((await runNavRule(wrapperFixture.rootDir)).status).toBe("fail");
      expect((await runNavRule(rootsFixture.rootDir)).status).toBe("fail");
    } finally {
      await Promise.all([wrapperFixture.cleanup(), rootsFixture.cleanup()]);
    }
  });

  it("passes for hydrateRoot and returns advisory for rootless generic exports", async () => {
    const hydrateFixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });
    const rootlessFixture = await createRuleFixture();

    try {
      await hydrateFixture.write(
        "src/App.tsx",
        "export function App() { return <NavigationMenu />; }"
      );
      await hydrateFixture.write(
        "src/main.tsx",
        `
          import { hydrateRoot } from "react-dom/client";
          import { App } from "./App";
          hydrateRoot(document.getElementById("root"), <App />);
        `
      );
      await rootlessFixture.write(
        "src/Header.tsx",
        "export function Header() { return <NavigationMenu />; }"
      );

      expect((await runNavRule(hydrateFixture.rootDir)).status).toBe("pass");
      expect((await runNavRule(rootlessFixture.rootDir)).status).toBe(
        "advisory"
      );
    } finally {
      await Promise.all([hydrateFixture.cleanup(), rootlessFixture.cleanup()]);
    }
  });

  it("composes App Router templates with pages", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html>{children}</html>; }"
      );
      await fixture.write(
        "app/template.tsx",
        "export default function Template({ children }) { return <><NavigationMenu />{children}</>; }"
      );
      await fixture.write(
        "app/page.tsx",
        "export default function Page() { return <NavigationMenu />; }"
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("fail");
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns advisory for parallel slots independent of parameter syntax", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "app/layout.tsx",
        "export default function Layout(props) { return <html>{props.children}{props.modal}</html>; }"
      );
      await fixture.write(
        "app/page.tsx",
        "export default function Page() { return <NavigationMenu />; }"
      );
      await fixture.write(
        "app/@modal/default.tsx",
        "export default function Modal() { return <NavigationMenu />; }"
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns advisory for unsupported custom Next page extensions", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });

    try {
      await fixture.write(
        "next.config.ts",
        'export default { pageExtensions: ["screen.tsx"] };'
      );
      await fixture.write(
        "app/home.screen.tsx",
        "export default function Home() { return <NavigationMenu />; }"
      );

      expect((await runNavRule(fixture.rootDir)).status).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("turns every graph-level incompleteness into advisory without hiding proven failures", async () => {
    const genericFixture = await createRuleFixture();
    const routesFixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });

    try {
      await genericFixture.write(
        "src/App.tsx",
        `
          export function App() { return <><nav aria-label="Primary" /><nav aria-label="Utility" /><main /></>; }
          function Extra() { return <aside />; }
        `
      );
      await routesFixture.write(
        "app/layout.tsx",
        "export default function Layout({ children }) { return <html>{children}</html>; }"
      );
      await routesFixture.write(
        "app/a/page.tsx",
        "export default function A() { return <><NavigationMenu /><NavigationMenu /></>; }"
      );
      await routesFixture.write(
        "app/b/page.tsx",
        "export default function B() { return <NavigationMenu />; }"
      );

      const createGraph = async (
        limits?: Parameters<typeof buildComponentRenderGraph>[2],
        partial = false
      ) => {
        const project = await discoverProject(genericFixture.rootDir, {
          filesystemRoot: genericFixture.rootDir,
        });
        if (partial) {
          project.sourceCoverage = "partial";
        }
        return buildComponentRenderGraph(
          project,
          genericFixture.rootDir,
          limits
        );
      };
      const edgeGraph = await createGraph({ limits: { maxEdges: 2 } });
      const nodeGraph = await createGraph({ limits: { maxNodes: 1 } });
      const totalGraph = await createGraph({
        limits: { maxTotalInstances: 1 },
      });
      const partialGraph = await createGraph(undefined, true);
      const routesProject = await discoverProject(routesFixture.rootDir, {
        filesystemRoot: routesFixture.rootDir,
      });
      const surfaceGraph = await buildComponentRenderGraph(
        routesProject,
        routesFixture.rootDir,
        { limits: { maxSurfaces: 1 } }
      );

      expect(evaluateNavigationRenderGraph(edgeGraph).status).toBe("advisory");
      expect(evaluateNavigationRenderGraph(nodeGraph).status).toBe("advisory");
      expect(evaluateNavigationRenderGraph(totalGraph).status).toBe("advisory");
      expect(evaluateNavigationRenderGraph(partialGraph).status).toBe(
        "advisory"
      );
      expect(evaluateNavigationRenderGraph(surfaceGraph).status).toBe("fail");
    } finally {
      await Promise.all([genericFixture.cleanup(), routesFixture.cleanup()]);
    }
  });
});
