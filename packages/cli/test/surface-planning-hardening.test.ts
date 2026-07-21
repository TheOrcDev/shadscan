import { describe, expect, it } from "vitest";
import { buildComponentRenderGraph } from "../src/component-render-graph";
import { discoverProject } from "../src/discovery";
import { evaluateNavigationRenderGraph } from "../src/rules/nav-landmarks-have-names";
import { createRuleFixture } from "./rule-fixture";

const buildGraph = async (
  rootDir: string,
  options?: Parameters<typeof buildComponentRenderGraph>[2]
) => {
  const project = await discoverProject(rootDir, { filesystemRoot: rootDir });
  return buildComponentRenderGraph(project, rootDir, options);
};

describe("render surface planning hardening", () => {
  it("selects the index.html entry without merging stale main files", async () => {
    const fixture = await createRuleFixture({ react: "19.2.4", vite: "7.0.0" });
    try {
      await fixture.write(
        "index.html",
        '<div id="app"></div><script type="module" src="/src/index.tsx"></script>'
      );
      await fixture.write(
        "src/index.tsx",
        `
          import { createRoot as mount } from "react-dom/client";
          function Primary() { return <nav aria-label="Primary" />; }
          function Utility() { return <nav aria-label="Utility" />; }
          mount(document.getElementById("one")).render(<Primary />);
          mount(document.getElementById("two")).render(<Utility />);
        `
      );
      await fixture.write(
        "src/main.tsx",
        "function Stale() { return <><nav /><nav /></>; }"
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(graph.surfaces).toHaveLength(1);
      expect(
        graph.surfaces[0]?.instances.filter(({ tagName }) => tagName === "nav")
      ).toHaveLength(2);
      expect(evaluateNavigationRenderGraph(graph).status).toBe("pass");
    } finally {
      await fixture.cleanup();
    }
  });

  it("recognizes aliased hydration and marks mixed mount flow partial", async () => {
    const hydrateFixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });
    const mixedFixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });
    try {
      await hydrateFixture.write(
        "src/main.tsx",
        `
          import { hydrateRoot as hydrate } from "react-dom/client";
          function App() { return <nav aria-label="Primary" />; }
          hydrate(document.getElementById("root"), <App />);
        `
      );
      await mixedFixture.write(
        "src/main.tsx",
        `
          import { createRoot as mount } from "react-dom/client";
          function App() { return <nav aria-label="Primary" />; }
          mount(document.getElementById("root")).render(<App />);
          runtimeRoot.render(window.secondaryTree);
        `
      );

      expect(
        evaluateNavigationRenderGraph(await buildGraph(hydrateFixture.rootDir))
          .status
      ).toBe("pass");
      expect(
        evaluateNavigationRenderGraph(await buildGraph(mixedFixture.rootDir))
          .status
      ).toBe("advisory");
    } finally {
      await Promise.all([hydrateFixture.cleanup(), mixedFixture.cleanup()]);
    }
  });

  it("ignores uncalled helpers and does not combine if/else mounts", async () => {
    const helperFixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });
    const branchFixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });
    try {
      await helperFixture.write(
        "src/main.tsx",
        `
          import { createRoot } from "react-dom/client";
          function Hidden() { return <><nav /><nav /></>; }
          function unused() { createRoot(document.body).render(<Hidden />); }
          function App() { return <nav aria-label="Primary" />; }
          const boot = () => {
            const root = createRoot(document.body);
            root.render(<App />);
          };
          boot();
        `
      );
      await branchFixture.write(
        "src/main.tsx",
        `
          import { createRoot } from "react-dom/client";
          function One() { return <nav />; }
          function Two() { return <nav />; }
          if (window.primary) {
            createRoot(document.body).render(<One />);
          } else {
            createRoot(document.body).render(<Two />);
          }
        `
      );

      expect(
        evaluateNavigationRenderGraph(await buildGraph(helperFixture.rootDir))
          .status
      ).toBe("pass");
      expect(
        evaluateNavigationRenderGraph(await buildGraph(branchFixture.rootDir))
          .status
      ).toBe("advisory");
    } finally {
      await Promise.all([helperFixture.cleanup(), branchFixture.cleanup()]);
    }
  });

  it("only marks meaningful transparent wrapper visibility partial", async () => {
    const staticFixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });
    const responsiveFixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });
    try {
      await staticFixture.write(
        "src/main.tsx",
        `
          import { createRoot } from "react-dom/client";
          function App() { return <nav aria-label="Primary" />; }
          createRoot(document.body).render(<div className="app"><App /></div>);
        `
      );
      await responsiveFixture.write(
        "src/main.tsx",
        `
          import { createRoot } from "react-dom/client";
          function App() { return <nav aria-label="Primary" />; }
          createRoot(document.body).render(<div className="lg:hidden"><App /></div>);
        `
      );
      expect(
        evaluateNavigationRenderGraph(await buildGraph(staticFixture.rootDir))
          .status
      ).toBe("pass");
      expect(
        evaluateNavigationRenderGraph(
          await buildGraph(responsiveFixture.rootDir)
        ).status
      ).toBe("advisory");
    } finally {
      await Promise.all([staticFixture.cleanup(), responsiveFixture.cleanup()]);
    }
  });

  it("excludes private routes and composes nested templates and loading fallbacks", async () => {
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
        "app/dashboard/template.tsx",
        'export default function Template({ children }) { return <><nav aria-label="Template" />{children}</>; }'
      );
      await fixture.write(
        "app/dashboard/page.tsx",
        "export default function Page() { return <main />; }"
      );
      await fixture.write(
        "app/dashboard/loading.tsx",
        'export default function Loading() { return <nav aria-label="Loading" />; }'
      );
      await fixture.write(
        "app/_private/page.tsx",
        "export default function Private() { return <><nav /><nav /></>; }"
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(graph.surfaces.map(({ id }) => id)).toEqual([
        "next-app-loading:/dashboard:dashboard/loading.tsx",
        "next-app:/dashboard:dashboard/page.tsx",
      ]);
      expect(
        graph.surfaces[0]?.instances.filter(({ tagName }) => tagName === "nav")
      ).toHaveLength(2);
      expect(
        graph.surfaces[1]?.instances.filter(({ tagName }) => tagName === "nav")
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("honors static custom page extensions for App and Pages routers", async () => {
    const appFixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });
    const pagesFixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });
    try {
      await appFixture.write(
        "next.config.ts",
        'export default { pageExtensions: ["screen.tsx"] };'
      );
      await appFixture.write(
        "app/layout.screen.tsx",
        "export default function Layout({ children }) { return <html>{children}</html>; }"
      );
      await appFixture.write(
        "app/page.screen.tsx",
        'export default function Page() { return <nav aria-label="Primary" />; }'
      );
      await appFixture.write(
        "app/page.tsx",
        "export default function Excluded() { return <><nav /><nav /></>; }"
      );
      await pagesFixture.write(
        "next.config.ts",
        'const extensions = ["screen.tsx"]; export default { pageExtensions: extensions };'
      );
      await pagesFixture.write(
        "pages/home.screen.tsx",
        'export default function Home() { return <nav aria-label="Primary" />; }'
      );
      await pagesFixture.write(
        "pages/stale.tsx",
        "export default function Stale() { return <><nav /><nav /></>; }"
      );

      expect(
        evaluateNavigationRenderGraph(await buildGraph(appFixture.rootDir))
          .status
      ).toBe("pass");
      expect(
        evaluateNavigationRenderGraph(await buildGraph(pagesFixture.rootDir))
          .status
      ).toBe("pass");
    } finally {
      await Promise.all([appFixture.cleanup(), pagesFixture.cleanup()]);
    }
  });

  it("does not assert routes from unreadable page extensions", async () => {
    const dynamicFixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });
    try {
      await dynamicFixture.write(
        "next.config.ts",
        "export default { pageExtensions: getExtensions() }; "
      );
      await dynamicFixture.write(
        "app/page.tsx",
        "export default function Page() { return <><nav /><nav /></>; }"
      );

      const graph = await buildGraph(dynamicFixture.rootDir);
      expect(graph.surfaces).toHaveLength(0);
      expect(evaluateNavigationRenderGraph(graph).status).toBe("advisory");
    } finally {
      await dynamicFixture.cleanup();
    }
  });

  it("makes clean surface truncation advisory while preserving proven failures", async () => {
    const cleanFixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });
    const duplicateFixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });
    try {
      await cleanFixture.write(
        "app/a/page.tsx",
        'export default function A() { return <nav aria-label="A" />; }'
      );
      await cleanFixture.write(
        "app/b/page.tsx",
        'export default function B() { return <nav aria-label="B" />; }'
      );
      await duplicateFixture.write(
        "app/a/page.tsx",
        "export default function A() { return <><nav /><nav /></>; }"
      );
      await duplicateFixture.write(
        "app/b/page.tsx",
        'export default function B() { return <nav aria-label="B" />; }'
      );

      expect(
        evaluateNavigationRenderGraph(
          await buildGraph(cleanFixture.rootDir, {
            limits: { maxSurfaces: 1 },
          })
        ).status
      ).toBe("advisory");
      expect(
        evaluateNavigationRenderGraph(
          await buildGraph(duplicateFixture.rootDir, {
            limits: { maxSurfaces: 1 },
          })
        ).status
      ).toBe("fail");
    } finally {
      await Promise.all([cleanFixture.cleanup(), duplicateFixture.cleanup()]);
    }
  });

  it("returns advisory when no recognizable surfaces exist", async () => {
    const fixture = await createRuleFixture({
      next: "16.2.10",
      react: "19.2.4",
    });
    try {
      await fixture.write(
        "app/_private/page.tsx",
        "export default function PrivatePage() { return <nav />; }"
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(graph.surfaces).toHaveLength(0);
      expect(evaluateNavigationRenderGraph(graph).status).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });
});
