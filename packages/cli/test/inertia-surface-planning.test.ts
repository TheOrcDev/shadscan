import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildComponentRenderGraph } from "../src/component-render-graph";
import { discoverProject } from "../src/discovery";
import { createRuleFixture } from "./rule-fixture";

const LARAVEL_DEPENDENCIES = {
  "@inertiajs/react": "2.0.11",
  "laravel-vite-plugin": "1.3.0",
  react: "19.2.4",
};

const scaffoldLaravel = async (
  fixture: Awaited<ReturnType<typeof createRuleFixture>>
): Promise<void> => {
  await writeFile(
    path.join(fixture.rootDir, "artisan"),
    "#!/usr/bin/env php\n"
  );
  await mkdir(path.join(fixture.rootDir, "resources", "views"), {
    recursive: true,
  });
  await writeFile(
    path.join(fixture.rootDir, "resources", "views", "app.blade.php"),
    '<html lang="en"><body>@inertia</body></html>\n'
  );
};

const buildGraph = async (rootDir: string) => {
  const project = await discoverProject(rootDir, { filesystemRoot: rootDir });
  return buildComponentRenderGraph(project, rootDir);
};

describe("inertia surface planning", () => {
  it("seeds one surface per page from its default export", async () => {
    const fixture = await createRuleFixture(LARAVEL_DEPENDENCIES);

    try {
      await scaffoldLaravel(fixture);
      await fixture.write(
        "resources/js/pages/dashboard.tsx",
        `export default function Dashboard() {
  return (
    <section aria-label="Dashboard">
      <h1>Dashboard</h1>
    </section>
  );
}
`
      );
      await fixture.write(
        "resources/js/pages/settings/profile.tsx",
        `export default function Profile() {
  return <form aria-label="Profile" />;
}
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const inertiaSurfaces = graph.surfaces.filter(
        (surface) => surface.adapter === "laravel-inertia-react"
      );
      const routeKeys = inertiaSurfaces.map((surface) => surface.routeKey);
      const renderedTags = inertiaSurfaces.flatMap((surface) =>
        surface.instances.map((instance) => instance.tagName)
      );

      expect(routeKeys).toEqual(
        expect.arrayContaining(["dashboard", "settings/profile"])
      );
      expect(renderedTags).toEqual(
        expect.arrayContaining(["section", "h1", "form"])
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("wraps pages in resolved persistent layouts", async () => {
    const fixture = await createRuleFixture(LARAVEL_DEPENDENCIES);

    try {
      await scaffoldLaravel(fixture);
      await fixture.write(
        "resources/js/layouts/app-layout.tsx",
        `export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav aria-label="Primary" />
      {children}
    </div>
  );
}
`
      );
      await fixture.write(
        "resources/js/pages/dashboard.tsx",
        `import AppLayout from "../layouts/app-layout";

function Dashboard() {
  return <main>Dashboard</main>;
}

Dashboard.layout = (page: React.ReactNode) => <AppLayout>{page}</AppLayout>;

export default Dashboard;
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const dashboardSurface = graph.surfaces.find(
        (surface) => surface.routeKey === "dashboard"
      );
      const renderedTags =
        dashboardSurface?.instances.map((instance) => instance.tagName) ?? [];

      expect(renderedTags).toEqual(expect.arrayContaining(["nav", "main"]));
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves page imports through the laravel tsconfig alias", async () => {
    const fixture = await createRuleFixture(LARAVEL_DEPENDENCIES);

    try {
      await scaffoldLaravel(fixture);
      await fixture.write(
        "tsconfig.json",
        `${JSON.stringify(
          {
            compilerOptions: {
              baseUrl: ".",
              jsx: "react-jsx",
              paths: { "@/*": ["./resources/js/*"] },
            },
          },
          null,
          2
        )}\n`
      );
      await fixture.write(
        "resources/js/components/stat-card.tsx",
        `export function StatCard() {
  return <article aria-label="Stat" />;
}
`
      );
      await fixture.write(
        "resources/js/pages/dashboard.tsx",
        `import { StatCard } from "@/components/stat-card";

export default function Dashboard() {
  return (
    <main>
      <StatCard />
    </main>
  );
}
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const dashboardSurface = graph.surfaces.find(
        (surface) => surface.routeKey === "dashboard"
      );
      const renderedTags =
        dashboardSurface?.instances.map((instance) => instance.tagName) ?? [];

      expect(renderedTags).toContain("article");
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a graph boundary for non-default page globs", async () => {
    const fixture = await createRuleFixture(LARAVEL_DEPENDENCIES);

    try {
      await scaffoldLaravel(fixture);
      await fixture.write(
        "resources/js/pages/home.tsx",
        "export default function Home() { return <main />; }\n"
      );
      await fixture.write(
        "resources/js/app.tsx",
        `import { createInertiaApp } from "@inertiajs/react";

createInertiaApp({
  resolve: (name) => import(\`./screens/\${name}.tsx\`),
  setup() {},
});
`
      );

      const graph = await buildGraph(fixture.rootDir);

      expect(graph.boundaryReasons.join("\n")).toContain("non-default glob");
    } finally {
      await fixture.cleanup();
    }
  });

  it("builds an identical graph on repeated runs", async () => {
    const fixture = await createRuleFixture(LARAVEL_DEPENDENCIES);

    try {
      await scaffoldLaravel(fixture);
      await fixture.write(
        "resources/js/pages/home.tsx",
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
