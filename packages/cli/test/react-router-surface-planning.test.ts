import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildComponentRenderGraph } from "../src/component-render-graph";
import { discoverProject } from "../src/discovery";
import { createRuleFixture } from "./rule-fixture";

const REACT_ROUTER_DEPENDENCIES = {
  "@react-router/dev": "7.9.1",
  react: "19.2.4",
  "react-router": "7.9.1",
};

const ROOT_MODULE = `import { Outlet } from "react-router";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
`;

const scaffold = async (
  fixture: Awaited<ReturnType<typeof createRuleFixture>>
): Promise<void> => {
  await writeFile(
    path.join(fixture.rootDir, "react-router.config.ts"),
    "export default { ssr: true };\n"
  );
  await fixture.write("app/root.tsx", ROOT_MODULE);
};

const buildGraph = async (rootDir: string) => {
  const project = await discoverProject(rootDir, { filesystemRoot: rootDir });
  return buildComponentRenderGraph(project, rootDir);
};

describe("react router surface planning", () => {
  it("seeds a surface per route module listed in routes.ts", async () => {
    const fixture = await createRuleFixture(REACT_ROUTER_DEPENDENCIES);

    try {
      await scaffold(fixture);
      await fixture.write(
        "app/routes.ts",
        `import { index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("about", "routes/about.tsx"),
];
`
      );
      await fixture.write(
        "app/routes/home.tsx",
        `export default function Home() {
  return (
    <section aria-label="Home">
      <h1>Home</h1>
    </section>
  );
}
`
      );
      await fixture.write(
        "app/routes/about.tsx",
        'export default function About() {\n  return <article aria-label="About" />;\n}\n'
      );

      const graph = await buildGraph(fixture.rootDir);
      const surfaces = graph.surfaces.filter(
        (surface) => surface.adapter === "react-router-framework"
      );
      const routeKeys = surfaces.map((surface) => surface.routeKey);
      const renderedTags = surfaces.flatMap((surface) =>
        surface.instances.map((instance) => instance.tagName)
      );

      expect(routeKeys).toEqual(
        expect.arrayContaining(["root", "routes/home", "routes/about"])
      );
      expect(renderedTags).toEqual(
        expect.arrayContaining(["section", "h1", "article"])
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("falls back to directory discovery when routes.ts is unreadable", async () => {
    const fixture = await createRuleFixture(REACT_ROUTER_DEPENDENCIES);

    try {
      await scaffold(fixture);
      await fixture.write(
        "app/routes.ts",
        `import { flatRoutes } from "@react-router/fs-routes";

export default flatRoutes();
`
      );
      await fixture.write(
        "app/routes/dashboard.tsx",
        'export default function Dashboard() {\n  return <main aria-label="Dashboard" />;\n}\n'
      );

      const graph = await buildGraph(fixture.rootDir);
      const dashboard = graph.surfaces.find(
        (surface) => surface.routeKey === "routes/dashboard"
      );

      expect(dashboard).toBeDefined();
      expect(graph.boundaryReasons.join("\n")).toContain(
        "not statically readable"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("treats ErrorBoundary and HydrateFallback as rendered surfaces", async () => {
    const fixture = await createRuleFixture(REACT_ROUTER_DEPENDENCIES);

    try {
      await scaffold(fixture);
      await fixture.write(
        "app/routes/home.tsx",
        `export default function Home() {
  return <main aria-label="Home" />;
}

export function ErrorBoundary() {
  return <aside aria-label="Route error" />;
}

export function HydrateFallback() {
  return <output aria-busy="true" />;
}
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const home = graph.surfaces.find(
        (surface) => surface.routeKey === "routes/home"
      );
      const renderedTags =
        home?.instances.map((instance) => instance.tagName) ?? [];

      expect(renderedTags).toEqual(
        expect.arrayContaining(["main", "aside", "output"])
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves route components imported through the ~ alias", async () => {
    const fixture = await createRuleFixture(REACT_ROUTER_DEPENDENCIES);

    try {
      await scaffold(fixture);
      await fixture.write(
        "tsconfig.json",
        `${JSON.stringify(
          {
            compilerOptions: {
              baseUrl: ".",
              jsx: "react-jsx",
              paths: { "~/*": ["./app/*"] },
            },
          },
          null,
          2
        )}\n`
      );
      await fixture.write(
        "app/components/stat-card.tsx",
        'export function StatCard() {\n  return <article aria-label="Stat" />;\n}\n'
      );
      await fixture.write(
        "app/routes/home.tsx",
        `import { StatCard } from "~/components/stat-card";

export default function Home() {
  return (
    <main>
      <StatCard />
    </main>
  );
}
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const home = graph.surfaces.find(
        (surface) => surface.routeKey === "routes/home"
      );
      const renderedTags =
        home?.instances.map((instance) => instance.tagName) ?? [];

      expect(renderedTags).toContain("article");
    } finally {
      await fixture.cleanup();
    }
  });

  it("builds an identical graph on repeated runs", async () => {
    const fixture = await createRuleFixture(REACT_ROUTER_DEPENDENCIES);

    try {
      await scaffold(fixture);
      await fixture.write(
        "app/routes/home.tsx",
        'export default function Home() { return <main aria-label="Home" />; }\n'
      );

      const project = (graph: Awaited<ReturnType<typeof buildGraph>>) =>
        JSON.stringify({
          boundaryReasons: graph.boundaryReasons,
          edges: graph.edges.map((edge) => edge.tagName),
          nodes: graph.nodes.map((node) => node.id),
          surfaces: graph.surfaces.map((surface) => ({
            boundaryReasons: surface.boundaryReasons,
            id: surface.id,
            instances: surface.instances.map((instance) => instance.tagName),
            routeKey: surface.routeKey,
          })),
        });
      const first = await buildGraph(fixture.rootDir);
      const second = await buildGraph(fixture.rootDir);

      expect(project(second)).toBe(project(first));
    } finally {
      await fixture.cleanup();
    }
  });
});
