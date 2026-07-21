import path from "node:path";
import { describe, expect, it } from "vitest";
import { getJsxAttributeValue } from "../src/ast";
import { buildComponentRenderGraph } from "../src/component-render-graph";
import { discoverProject } from "../src/discovery";
import { navLandmarksHaveNamesRule } from "../src/rules/nav-landmarks-have-names";
import { createRuleFixture, runRule } from "./rule-fixture";

const buildGraph = async (
  rootDir: string,
  options?: Parameters<typeof buildComponentRenderGraph>[2],
  filesystemRoot = rootDir
) => {
  const project = await discoverProject(rootDir, { filesystemRoot });
  return buildComponentRenderGraph(project, filesystemRoot, options);
};

const getRenderedTags = (
  graph: Awaited<ReturnType<typeof buildComponentRenderGraph>>
): string[] =>
  graph.surfaces.flatMap((surface) =>
    surface.instances.map((instance) => instance.tagName)
  );

const writeViteMount = async (
  fixture: { write: (filePath: string, content: string) => Promise<void> },
  appImport = "./App"
): Promise<void> => {
  await fixture.write(
    "src/main.tsx",
    `
      import { createRoot } from "react-dom/client";
      import { App } from ${JSON.stringify(appImport)};
      createRoot(document.getElementById("root")).render(<App />);
    `
  );
};

describe("symbol resolution hardening", () => {
  it("bounds deep re-export resolution with a deterministic partial result", async () => {
    const fixture = await createRuleFixture({ react: "19.2.4", vite: "7.0.0" });

    try {
      await fixture.write(
        "src/Header.tsx",
        'export function Header() { return <nav aria-label="Header" />; }'
      );
      for (let index = 0; index < 8; index += 1) {
        const target = index === 7 ? "./Header" : `./barrel-${index + 1}`;
        await fixture.write(
          `src/barrel-${index}.ts`,
          `export { Header } from ${JSON.stringify(target)};`
        );
      }
      await fixture.write(
        "src/App.tsx",
        'import { Header } from "./barrel-0"; export function App() { return <Header />; }'
      );
      await writeViteMount(fixture);

      const first = await buildGraph(fixture.rootDir, {
        limits: { maxDepth: 2 },
      });
      const second = await buildGraph(fixture.rootDir, {
        limits: { maxDepth: 2 },
      });
      const firstEdge = first.edges.find((edge) => edge.tagName === "Header");

      expect(firstEdge).toMatchObject({
        resolution: "unresolved",
        target: null,
      });
      expect(first.surfaces[0]?.completeness).toBe("partial");
      expect(first.surfaces[0]?.boundaryReasons.join(" ")).toContain(
        "hop limit (2)"
      );
      expect(first.boundaryReasons).toEqual(second.boundaryReasons);
      expect(first.edges).toEqual(second.edges);
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves imported and nested declarations by lexical owner", async () => {
    const fixture = await createRuleFixture({ react: "19.2.4", vite: "7.0.0" });

    try {
      await fixture.write(
        "src/Header.tsx",
        'export function Header() { return <nav aria-label="Imported" />; }'
      );
      await writeViteMount(fixture);
      await fixture.write(
        "src/App.tsx",
        `
          import { Header } from "./Header";
          function Outer() {
            function Header() { return <nav aria-label="Nested" />; }
            return <Header />;
          }
          export function App() { return <><Header /><Outer /></>; }
        `
      );

      const graph = await buildGraph(fixture.rootDir);
      const importedHeader = graph.nodes.find(
        (node) =>
          node.localName === "Header" && node.filePath.endsWith("Header.tsx")
      );
      const nestedHeader = graph.nodes.find(
        (node) =>
          node.localName === "Header" && node.filePath.endsWith("App.tsx")
      );
      const app = graph.nodes.find((node) => node.localName === "App");
      const outer = graph.nodes.find((node) => node.localName === "Outer");
      const headerEdges = graph.edges.filter(
        (edge) => edge.tagName === "Header"
      );

      expect(headerEdges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            from: app?.id,
            target: importedHeader?.id,
          }),
          expect.objectContaining({
            from: outer?.id,
            target: nestedHeader?.id,
          }),
        ])
      );
      expect(
        graph.surfaces
          .flatMap((surface) => surface.instances)
          .filter((instance) => instance.tagName === "nav")
          .map((instance) => getJsxAttributeValue(instance.node, "aria-label"))
      ).toEqual([
        { kind: "static", value: "Imported" },
        { kind: "static", value: "Nested" },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves a neutral component through bounded export-star barrels", async () => {
    const fixture = await createRuleFixture({ react: "19.2.4", vite: "7.0.0" });

    try {
      await fixture.write(
        "src/Header.tsx",
        'export function Header() { return <nav aria-label="Primary" />; }'
      );
      await fixture.write("src/inner.ts", 'export * from "./Header";');
      await fixture.write("src/index.ts", 'export * from "./inner";');
      await fixture.write(
        "src/App.tsx",
        'import { Header } from "./index"; export function App() { return <Header />; }'
      );
      await writeViteMount(fixture);

      const graph = await buildGraph(fixture.rootDir);

      expect(
        graph.edges.find((edge) => edge.tagName === "Header")
      ).toMatchObject({ resolution: "resolved" });
      expect(getRenderedTags(graph)).toContain("nav");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps ambiguous neutral export-star paths navigation-relevant", async () => {
    const fixture = await createRuleFixture({ react: "19.2.4", vite: "7.0.0" });

    try {
      await fixture.write(
        "src/Primary.tsx",
        'export function Header() { return <nav aria-label="Primary" />; }'
      );
      await fixture.write(
        "src/Secondary.tsx",
        'export function Header() { return <nav aria-label="Secondary" />; }'
      );
      await fixture.write(
        "src/index.ts",
        'export * from "./Primary"; export * from "./Secondary";'
      );
      await fixture.write(
        "src/App.tsx",
        'import { Header } from "./index"; export function App() { return <Header />; }'
      );
      await writeViteMount(fixture);

      const graph = await buildGraph(fixture.rootDir);

      expect(
        graph.edges.find((edge) => edge.tagName === "Header")
      ).toMatchObject({ resolution: "unresolved", target: null });
      expect(graph.surfaces[0]?.completeness).toBe("partial");
      expect(graph.surfaces[0]?.boundaryReasons.join(" ")).toContain(
        "ambiguous"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps sibling-package alias targets outside the selected source index unresolved", async () => {
    const fixture = await createRuleFixture();
    const appRoot = path.join(fixture.rootDir, "apps", "web");

    try {
      await fixture.write(
        "apps/web/package.json",
        JSON.stringify({
          dependencies: { react: "19.2.4", vite: "7.0.0" },
          name: "web",
        })
      );
      await fixture.write(
        "apps/web/tsconfig.json",
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "@shared/*": ["../../packages/shared/src/*"] },
          },
        })
      );
      await fixture.write(
        "packages/shared/src/Header.tsx",
        'export function Header() { return <nav aria-label="Shared" />; }'
      );
      await fixture.write(
        "apps/web/src/App.tsx",
        'import { Header } from "@shared/Header"; export function App() { return <Header />; }'
      );
      await fixture.write(
        "apps/web/src/main.tsx",
        `
          import { createRoot } from "react-dom/client";
          import { App } from "./App";
          createRoot(document.getElementById("root")).render(<App />);
        `
      );

      const graph = await buildGraph(appRoot, undefined, fixture.rootDir);

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

  it("resolves statically readable Vite aliases to indexed local source", async () => {
    const fixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });

    try {
      await fixture.write(
        "vite.config.ts",
        `
          import path from "node:path";
          import { defineConfig } from "vite";
          export default defineConfig({ resolve: { alias: { "@": path.resolve(__dirname, "./src") } } });
        `
      );
      await fixture.write(
        "src/App.tsx",
        'export function App() { return <><nav aria-label="One" /><nav aria-label="Two" /></>; }'
      );
      await fixture.write(
        "src/main.tsx",
        `
          import { createRoot } from "react-dom/client";
          import { App } from "@/App";
          createRoot(document.getElementById("root")).render(<App />);
        `
      );

      const graph = await buildGraph(fixture.rootDir);

      expect(
        getRenderedTags(graph).filter((tag) => tag === "nav")
      ).toHaveLength(2);
      expect(graph.surfaces[0]?.completeness).toBe("complete");
    } finally {
      await fixture.cleanup();
    }
  });

  it("marks dynamic Vite aliases with neutral navigation as advisory", async () => {
    const fixture = await createRuleFixture({
      react: "19.2.4",
      vite: "7.0.0",
    });

    try {
      await fixture.write(
        "vite.config.ts",
        `
          import { defineConfig } from "vite";
          export default defineConfig({ resolve: { alias: getAliases() } });
        `
      );
      await fixture.write(
        "src/Header.tsx",
        "export default function Header() { return <><nav /><nav /></>; }"
      );
      await fixture.write(
        "src/App.tsx",
        'import Header from "local-header"; export function App() { return <Header />; }'
      );
      await writeViteMount(fixture);

      const graph = await buildGraph(fixture.rootDir);
      const finding = await runRule(fixture.rootDir, navLandmarksHaveNamesRule);

      expect(graph.boundaryReasons.join(" ")).toContain(
        "Vite resolve.alias configuration could not be read statically"
      );
      expect(finding.status).toBe("advisory");
    } finally {
      await fixture.cleanup();
    }
  });

  it("bounds broad source-index child enumeration", async () => {
    const fixture = await createRuleFixture();

    try {
      const broadStatements = Array.from(
        { length: 1000 },
        (_, index) => `const value${index} = ${index};`
      ).join("\n");
      await fixture.write(
        "src/App.tsx",
        `export function App() { ${broadStatements} return <main />; }`
      );

      const graph = await buildGraph(fixture.rootDir, {
        limits: { maxNodes: 2 },
      });
      const runtimeMetrics = graph.metrics as typeof graph.metrics & {
        sourceIndexNodesVisited: number;
      };

      expect(graph.nodes).toHaveLength(1);
      expect(runtimeMetrics.sourceIndexNodesVisited).toBe(128);
      expect(graph.boundaryReasons.join(" ")).toContain(
        "source-index AST visit limit (128)"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps ordinary external components external without an advisory", async () => {
    const fixture = await createRuleFixture({ react: "19.2.4", vite: "7.0.0" });

    try {
      await fixture.write(
        "src/App.tsx",
        'import Header from "ordinary-package"; export function App() { return <Header />; }'
      );
      await writeViteMount(fixture);

      const graph = await buildGraph(fixture.rootDir);

      expect(
        graph.edges.find((edge) => edge.tagName === "Header")
      ).toMatchObject({ resolution: "external", target: null });
      expect(graph.surfaces[0]?.completeness).toBe("complete");
    } finally {
      await fixture.cleanup();
    }
  });
});
