import { describe, expect, it } from "vitest";
import { getJsxAttributeValue } from "../src/ast";
import {
  buildComponentRenderGraph,
  guardsCanCoexist,
} from "../src/component-render-graph";
import { discoverProject } from "../src/discovery";
import { createRuleFixture } from "./rule-fixture";

const buildGraph = async (
  rootDir: string,
  limits?: Parameters<typeof buildComponentRenderGraph>[2]
) => {
  const project = await discoverProject(rootDir, { filesystemRoot: rootDir });
  return buildComponentRenderGraph(project, rootDir, limits);
};

const getRenderedTags = (
  graph: Awaited<ReturnType<typeof buildComponentRenderGraph>>
): string[] =>
  graph.surfaces.flatMap((surface) =>
    surface.instances.map((instance) => instance.tagName)
  );

describe("component render graph", () => {
  it("resolves same-file, default, named alias, namespace, and direct re-exports", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/navs.tsx",
        `
          export default function Primary() { return <nav aria-label="Primary" />; }
          export function Secondary() { return <nav aria-label="Secondary" />; }
          export function Tools() { return <nav aria-label="Tools" />; }
          export function Unused() { return <nav aria-label="Unused" />; }
        `
      );
      await fixture.write(
        "src/barrel.ts",
        `
          export { default, default as Primary, Secondary } from "./navs";
          export { Tools } from "./navs";
        `
      );
      await fixture.write(
        "src/App.tsx",
        `
          import DefaultAlias, { Secondary as NamedAlias } from "./barrel";
          import * as Navigation from "./barrel";
          function LocalNav() { return <nav aria-label="Local" />; }
          export function App() {
            return <><LocalNav /><DefaultAlias /><NamedAlias /><Navigation.Tools /></>;
          }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      const resolvedTags = graph.edges
        .filter((edge) => edge.target)
        .map((edge) => edge.tagName);

      expect(resolvedTags).toEqual(
        expect.arrayContaining([
          "DefaultAlias",
          "LocalNav",
          "NamedAlias",
          "Navigation.Tools",
        ])
      );
      expect(
        getRenderedTags(graph).filter((tag) => tag === "nav")
      ).toHaveLength(4);
      const unusedComponent = graph.nodes.find(
        (node) =>
          node.filePath.endsWith("navs.tsx") && node.localName === "Unused"
      );
      const renderedNavs = graph.surfaces.flatMap((surface) =>
        surface.instances.filter((instance) => instance.tagName === "nav")
      );

      expect(unusedComponent).toBeDefined();
      expect(
        renderedNavs.map((instance) => instance.componentId)
      ).not.toContain(unusedComponent?.id);
      expect(
        renderedNavs.map((instance) =>
          getJsxAttributeValue(instance.node, "aria-label")
        )
      ).toEqual([
        { kind: "static", value: "Local" },
        { kind: "static", value: "Primary" },
        { kind: "static", value: "Secondary" },
        { kind: "static", value: "Tools" },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("preserves duplicate callsites and diamond instance paths", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Leaf() { return <nav aria-label="Shared" />; }
          function Left() { return <Leaf />; }
          function Right() { return <Leaf />; }
          export function App() { return <><Left /><Right /><Leaf /><Leaf /></>; }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      const leafEdges = graph.edges.filter((edge) => edge.tagName === "Leaf");
      const navInstances = graph.surfaces.flatMap((surface) =>
        surface.instances.filter((instance) => instance.tagName === "nav")
      );

      expect(leafEdges).toHaveLength(4);
      expect(navInstances).toHaveLength(4);
      expect(new Set(navInstances.map((instance) => instance.id)).size).toBe(4);
      expect(
        new Set(navInstances.map((instance) => instance.componentId)).size
      ).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("terminates cycles and records the affected surface boundary", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Recursive() { return <><nav aria-label="Recursive" /><Recursive /></>; }
          export function App() { return <Recursive />; }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(
        getRenderedTags(graph).filter((tag) => tag === "nav")
      ).toHaveLength(1);
      expect(graph.surfaces[0]?.completeness).toBe("partial");
      expect(graph.surfaces[0]?.boundaryReasons.join(" ")).toContain(
        "Component cycle"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("marks opposite conditional branches as mutually exclusive", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Nav() { return <nav aria-label="Primary" />; }
          export function App({ alternate }) { return alternate ? <Nav /> : <Nav />; }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      const navInstances = graph.surfaces[0]?.instances.filter(
        (instance) => instance.tagName === "nav"
      );

      expect(navInstances).toHaveLength(2);
      expect(
        guardsCanCoexist(
          navInstances?.[0]?.guards ?? [],
          navInstances?.[1]?.guards ?? []
        )
      ).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it("treats map rendering as navigation-relevant unknown multiplicity", async () => {
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

      const graph = await buildGraph(fixture.rootDir);
      expect(getRenderedTags(graph)).not.toContain("nav");
      expect(graph.surfaces[0]?.completeness).toBe("partial");
      expect(graph.surfaces[0]?.boundaryReasons.join(" ")).toContain(
        "unknown multiplicity"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("propagates caller children only through recognizable projections", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Nav() { return <nav aria-label="Projected" />; }
          function Projects({ children }) { return <section>{children}</section>; }
          function Ignores() { return <aside />; }
          export function App() {
            return <><Projects><Nav /></Projects><Ignores><Nav /></Ignores></>;
          }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      const navInstances = graph.surfaces.flatMap((surface) =>
        surface.instances.filter((instance) => instance.tagName === "nav")
      );

      expect(navInstances).toHaveLength(1);
      expect(
        graph.nodes.find((node) => node.localName === "Projects")
          ?.projectsChildren
      ).toBe(true);
      expect(
        graph.nodes.find((node) => node.localName === "Ignores")
          ?.projectsChildren
      ).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves confined tsconfig aliases", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "@/*": ["src/*"] },
          },
        })
      );
      await fixture.write(
        "src/components/Nav.tsx",
        'export function Nav() { return <nav aria-label="Aliased" />; }'
      );
      await fixture.write(
        "src/App.tsx",
        'import { Nav } from "@/components/Nav"; export function App() { return <Nav />; }'
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(
        graph.edges.find((edge) => edge.tagName === "Nav")?.resolution
      ).toBe("resolved");
      expect(getRenderedTags(graph)).toContain("nav");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps resolved local scripts missing from the source index unresolved", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
        })
      );
      await fixture.write(
        "src/Header.mts",
        "export function Header() { return null; }"
      );
      await fixture.write(
        "src/App.tsx",
        'import { Header } from "./Header.mjs"; export function App() { return <Header />; }'
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(
        graph.edges.find((edge) => edge.tagName === "Header")
      ).toMatchObject({ resolution: "unresolved", target: null });
      expect(graph.surfaces[0]?.completeness).toBe("partial");
      expect(graph.surfaces[0]?.boundaryReasons.join(" ")).toContain(
        "outside the indexed source set"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("recognizes a Vite render root and anonymous default component", async () => {
    const fixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });

    try {
      await fixture.write(
        "src/Root.tsx",
        'export default () => <nav aria-label="Application" />;'
      );
      await fixture.write(
        "src/App.tsx",
        "export default function StaleApp() { return <><nav /><nav /></>; }"
      );
      await fixture.write(
        "src/main.tsx",
        `
          import { StrictMode } from "react";
          import { createRoot } from "react-dom/client";
          import Root from "./Root";
          createRoot(document.getElementById("root")).render(<StrictMode><Root /></StrictMode>);
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(graph.surfaces).toHaveLength(1);
      expect(graph.surfaces[0]?.adapter).toBe("vite-react");
      expect(
        getRenderedTags(graph).filter((tag) => tag === "nav")
      ).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves unambiguous export-star component paths", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/Nav.tsx",
        'export function Nav() { return <nav aria-label="Primary" />; }'
      );
      await fixture.write("src/barrel.ts", 'export * from "./Nav";');
      await fixture.write(
        "src/App.tsx",
        'import { Nav } from "./barrel"; export function App() { return <Nav />; }'
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(graph.edges.find((edge) => edge.tagName === "Nav")).toMatchObject({
        resolution: "resolved",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects external and out-of-root component targets", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          import External from "some-package";
          import Outside from "../../outside";
          export function App() { return <><External /><Outside /></>; }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(
        graph.edges.find((edge) => edge.tagName === "External")
      ).toMatchObject({ resolution: "external", target: null });
      expect(
        graph.edges.find((edge) => edge.tagName === "Outside")
      ).toMatchObject({ resolution: "unresolved", target: null });
    } finally {
      await fixture.cleanup();
    }
  });

  it("applies injected resource limits deterministically", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function A() { return <nav aria-label="A" />; }
          function B() { return <nav aria-label="B" />; }
          export function App() { return <><A /><B /></>; }
        `
      );

      const options = { limits: { maxEdges: 1, maxNodes: 2 } };
      const first = await buildGraph(fixture.rootDir, options);
      const second = await buildGraph(fixture.rootDir, options);
      const summarize = (
        graph: Awaited<ReturnType<typeof buildComponentRenderGraph>>
      ) => ({
        boundaries: graph.boundaryReasons,
        edges: graph.edges.map((edge) => edge.id),
        nodes: graph.nodes.map((node) => node.id),
        surfaces: graph.surfaces.map((surface) => ({
          boundaries: surface.boundaryReasons,
          id: surface.id,
          instances: surface.instances.map((instance) => instance.id),
        })),
      });

      expect(summarize(first)).toEqual(summarize(second));
      expect(first.nodes).toHaveLength(2);
      expect(first.edges).toHaveLength(1);
      expect(first.boundaryReasons.join(" ")).toContain("limit");
    } finally {
      await fixture.cleanup();
    }
  });

  it("records every expansion resource boundary with small injected caps", async () => {
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
        `
          function Nav() { return <nav aria-label="Primary" />; }
          export default function Page({ first, second }) {
            return first ? (second ? <Nav /> : <Nav />) : <Nav />;
          }
        `
      );
      await fixture.write(
        "app/about/page.tsx",
        'export default function About() { return <nav aria-label="About" />; }'
      );

      const depthGraph = await buildGraph(fixture.rootDir, {
        limits: { maxDepth: 1 },
      });
      const instanceGraph = await buildGraph(fixture.rootDir, {
        limits: { maxInstancesPerSurface: 1 },
      });
      const totalGraph = await buildGraph(fixture.rootDir, {
        limits: { maxTotalInstances: 1 },
      });
      const guardGraph = await buildGraph(fixture.rootDir, {
        limits: { maxGuardAtomsPerPath: 1 },
      });
      const surfaceGraph = await buildGraph(fixture.rootDir, {
        limits: { maxSurfaces: 1 },
      });

      expect(
        depthGraph.surfaces
          .flatMap((surface) => surface.boundaryReasons)
          .join(" ")
      ).toContain("depth limit");
      expect(
        instanceGraph.surfaces
          .flatMap((surface) => surface.boundaryReasons)
          .join(" ")
      ).toContain("Rendered instance limit");
      expect(totalGraph.boundaryReasons.join(" ")).toContain(
        "Total rendered instance limit"
      );
      expect(
        guardGraph.surfaces
          .flatMap((surface) => surface.boundaryReasons)
          .join(" ")
      ).toContain("Render guard limit");
      expect(
        guardGraph.surfaces
          .flatMap((surface) => surface.instances)
          .some((instance) =>
            instance.uncertaintyReasons.some((reason) =>
              reason.includes("Render guard limit")
            )
          )
      ).toBe(true);
      expect(surfaceGraph.surfaces).toHaveLength(1);
      expect(surfaceGraph.boundaryReasons.join(" ")).toContain(
        "render surface limit"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("extracts only reachable return values and guards sequential early returns", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          export function App({ mobile }) {
            const unused = <nav aria-label="Unused" />;
            if (mobile) return <nav aria-label="Primary" />;
            return <nav aria-label="Primary" />;
            const unreachable = <nav aria-label="Unreachable" />;
          }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      const navs = graph.surfaces[0]?.instances.filter(
        (instance) => instance.tagName === "nav"
      );

      expect(
        navs?.map((instance) =>
          getJsxAttributeValue(instance.node, "aria-label")
        )
      ).toEqual([
        { kind: "static", value: "Primary" },
        { kind: "static", value: "Primary" },
      ]);
      expect(
        guardsCanCoexist(navs?.[0]?.guards ?? [], navs?.[1]?.guards ?? [])
      ).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it("classifies direct, unknown, and ignored children projection", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          function Nav() { return <nav aria-label="Projected" />; }
          function Direct({ children }) { return children; }
          function Conditional({ children, show }) { return show ? children : null; }
          function BodyDestructure(props) {
            const { children } = props;
            return <section>{children}</section>;
          }
          function ReactChildren({ children }) { return React.Children.only(children); }
          function Ignores({ children }) { return <aside />; }
          export function App() {
            return <><Direct><Nav /></Direct><Conditional show><Nav /></Conditional><BodyDestructure><Nav /></BodyDestructure></>;
          }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      const states = new Map(
        graph.nodes.map((node) => [node.localName, node.childrenProjection])
      );

      expect(states.get("Direct")).toBe("projected");
      expect(states.get("Conditional")).toBe("projected");
      expect(states.get("BodyDestructure")).toBe("unknown");
      expect(states.get("ReactChildren")).toBe("unknown");
      expect(states.get("Ignores")).toBe("ignored");
      expect(
        getRenderedTags(graph).filter((tag) => tag === "nav")
      ).toHaveLength(2);
      expect(graph.surfaces[0]?.completeness).toBe("partial");
      expect(graph.surfaces[0]?.boundaryReasons.join(" ")).toContain(
        "children projection is unknown"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("registers memo, forwardRef, and nested same-file components", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/App.tsx",
        `
          import { forwardRef, memo } from "react";
          const MemoHeader = memo(() => <nav aria-label="Memo" />);
          const RefHeader = forwardRef(function RefHeader() { return <nav aria-label="Ref" />; });
          export function App() {
            function NestedHeader() { return <nav aria-label="Nested" />; }
            return <><MemoHeader /><RefHeader /><NestedHeader /></>;
          }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      const labels = graph.surfaces
        .flatMap((surface) => surface.instances)
        .filter((instance) => instance.tagName === "nav")
        .map((instance) => getJsxAttributeValue(instance.node, "aria-label"));

      expect(labels).toEqual([
        { kind: "static", value: "Memo" },
        { kind: "static", value: "Ref" },
        { kind: "static", value: "Nested" },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves import-then-export barrels for named and default aliases", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/Header.tsx",
        `
          export default function PrimaryHeader() { return <nav aria-label="Primary" />; }
          export function Header() { return <nav aria-label="Utility" />; }
        `
      );
      await fixture.write(
        "src/barrel.ts",
        `
          import Primary from "./Header";
          import { Header as LocalHeader } from "./Header";
          export { Primary as default, LocalHeader as Header };
        `
      );
      await fixture.write(
        "src/App.tsx",
        `
          import Primary, { Header } from "./barrel";
          export function App() { return <><Primary /><Header /></>; }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(
        graph.edges
          .filter((edge) => ["Header", "Primary"].includes(edge.tagName))
          .map((edge) => edge.resolution)
      ).toEqual(["resolved", "resolved"]);
      expect(
        getRenderedTags(graph).filter((tag) => tag === "nav")
      ).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("marks imported neutral-name map composition navigation-relevant", async () => {
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

      const graph = await buildGraph(fixture.rootDir);
      expect(graph.surfaces[0]?.completeness).toBe("partial");
      expect(graph.surfaces[0]?.boundaryReasons.join(" ")).toContain(
        "unknown multiplicity"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("bounds edge construction and navigation reachability work", async () => {
    const edgeFixture = await createRuleFixture();
    const reachabilityFixture = await createRuleFixture();

    try {
      await edgeFixture.write(
        "src/App.tsx",
        `
          export function App() {
            return <><nav /><nav /><nav /><nav /><nav /></>;
          }
        `
      );
      await reachabilityFixture.write(
        "src/App.tsx",
        `
          function Leaf() { return <nav aria-label="Leaf" />; }
          function Shared() { return <Leaf />; }
          function Left() { return <Shared />; }
          function Right() { return <Shared />; }
          function CycleA() { return <CycleB />; }
          function CycleB() { return <><CycleA /><Leaf /></>; }
          export function App() { return <><Left /><Right /><CycleA /></>; }
        `
      );

      const edgeGraph = await buildGraph(edgeFixture.rootDir, {
        limits: { maxEdges: 2 },
      });
      const reachabilityGraph = await buildGraph(reachabilityFixture.rootDir);

      expect(edgeGraph.edges).toHaveLength(2);
      expect(edgeGraph.metrics.edgeTruncationMarkers).toBe(1);
      expect(edgeGraph.metrics.templateNodesVisited).toBeLessThanOrEqual(4);
      expect(
        reachabilityGraph.metrics.navigationReachabilityEvaluations
      ).toBeLessThanOrEqual(reachabilityGraph.nodes.length);
      expect(reachabilityGraph.surfaces[0]?.completeness).toBe("partial");
    } finally {
      await Promise.all([edgeFixture.cleanup(), reachabilityFixture.cleanup()]);
    }
  });

  it("bounds surface plans while producing deterministic routes", async () => {
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
        "app/page.tsx",
        "export default function Home() { return <main />; }"
      );
      await fixture.write(
        "app/a/page.tsx",
        "export default function A() { return <main />; }"
      );
      await fixture.write(
        "app/b/page.tsx",
        "export default function B() { return <main />; }"
      );

      const graph = await buildGraph(fixture.rootDir, {
        limits: { maxSurfaces: 1 },
      });

      expect(graph.surfaces).toHaveLength(1);
      expect(graph.metrics.surfacePlansCreated).toBe(1);
      expect(graph.metrics.surfaceCandidatesVisited).toBe(2);
      expect(graph.boundaryReasons.join(" ")).toContain("render surface limit");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps client wrapper children and concurrent roots in one surface", async () => {
    const fixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });

    try {
      await fixture.write(
        "src/components.tsx",
        `
          export function Shell({ children }) { return <main><nav aria-label="Main" />{children}</main>; }
          export function App() { return <nav aria-label="Main" />; }
          export function Utility() { return <nav aria-label="Utility" />; }
        `
      );
      await fixture.write(
        "src/main.tsx",
        `
          import { createRoot } from "react-dom/client";
          import { App, Shell, Utility } from "./components";
          createRoot(document.getElementById("one")).render(<Shell><App /></Shell>);
          createRoot(document.getElementById("two")).render(<Utility />);
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      expect(graph.surfaces).toHaveLength(1);
      expect(
        graph.surfaces[0]?.instances.filter((item) => item.tagName === "nav")
      ).toHaveLength(3);
    } finally {
      await fixture.cleanup();
    }
  });

  it("recognizes hydration mounts and marks rootless exports partial", async () => {
    const hydrateFixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });
    const rootlessFixture = await createRuleFixture();

    try {
      await hydrateFixture.write(
        "src/App.tsx",
        'export function App() { return <nav aria-label="Main" />; }'
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
        'export function Header() { return <nav aria-label="Main" />; }'
      );

      const hydrateGraph = await buildGraph(hydrateFixture.rootDir);
      const rootlessGraph = await buildGraph(rootlessFixture.rootDir);

      expect(hydrateGraph.surfaces[0]?.completeness).toBe("complete");
      expect(hydrateGraph.surfaces[0]?.instances).toHaveLength(1);
      expect(hydrateGraph.surfaces[0]?.instances[0]?.tagName).toBe("nav");
      expect(rootlessGraph.surfaces[0]?.completeness).toBe("partial");
      expect(rootlessGraph.surfaces[0]?.instances).toHaveLength(0);
    } finally {
      await Promise.all([hydrateFixture.cleanup(), rootlessFixture.cleanup()]);
    }
  });
});
