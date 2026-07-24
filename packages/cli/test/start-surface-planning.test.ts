import { describe, expect, it } from "vitest";
import { buildComponentRenderGraph } from "../src/component-render-graph";
import { discoverProject } from "../src/discovery";
import { createRuleFixture } from "./rule-fixture";

const START_DEPENDENCIES = {
  "@tanstack/react-router": "1.130.2",
  "@tanstack/react-start": "1.131.7",
  react: "19.2.4",
};

const ROOT_ROUTE = `import { createRootRoute, Outlet } from "@tanstack/react-router";

function RootDocument() {
  return (
    <html lang="en">
      <body>
        <main>
          <Outlet />
        </main>
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  component: RootDocument,
});
`;

const buildGraph = async (rootDir: string) => {
  const project = await discoverProject(rootDir, { filesystemRoot: rootDir });
  return buildComponentRenderGraph(project, rootDir);
};

describe("tanstack start surface planning", () => {
  it("seeds one surface per route file from its component options", async () => {
    const fixture = await createRuleFixture(START_DEPENDENCIES);

    try {
      await fixture.write("src/routes/__root.tsx", ROOT_ROUTE);
      await fixture.write(
        "src/routes/index.tsx",
        `import { createFileRoute } from "@tanstack/react-router";

function PendingState() {
  return <output aria-busy="true">Loading things…</output>;
}

function Home() {
  return (
    <section aria-label="Things">
      <h1>Things</h1>
    </section>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
  loader: () => Promise.resolve([]),
  pendingComponent: PendingState,
});
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const startSurfaces = graph.surfaces.filter(
        (surface) => surface.adapter === "tanstack-start"
      );
      const routeKeys = startSurfaces.map((surface) => surface.routeKey);
      const renderedTags = startSurfaces.flatMap((surface) =>
        surface.instances.map((instance) => instance.tagName)
      );

      expect(routeKeys).toEqual(expect.arrayContaining(["/", "__root"]));
      expect(renderedTags).toEqual(
        expect.arrayContaining(["html", "main", "section", "h1", "output"])
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("records boundary reasons for inline route components and Outlet composition", async () => {
    const fixture = await createRuleFixture(START_DEPENDENCIES);

    try {
      await fixture.write("src/routes/__root.tsx", ROOT_ROUTE);
      await fixture.write(
        "src/routes/about.tsx",
        `import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: () => <p>About</p>,
});
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const aboutSurface = graph.surfaces.find(
        (surface) => surface.routeKey === "/about"
      );
      const rootSurface = graph.surfaces.find(
        (surface) => surface.routeKey === "__root"
      );

      expect(aboutSurface?.boundaryReasons.join("\n")).toContain(
        "not a statically resolvable component reference"
      );
      expect(rootSurface?.boundaryReasons.join("\n")).toContain(
        "Outlet composition is not statically expanded"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("keys nested and index route files deterministically", async () => {
    const fixture = await createRuleFixture(START_DEPENDENCIES);

    try {
      await fixture.write("src/routes/__root.tsx", ROOT_ROUTE);
      await fixture.write(
        "src/routes/posts/index.tsx",
        `import { createFileRoute } from "@tanstack/react-router";

function PostsList() {
  return <ul aria-label="Posts" />;
}

export const Route = createFileRoute("/posts/")({
  component: PostsList,
});
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const postsSurface = graph.surfaces.find(
        (surface) => surface.routeKey === "/posts"
      );

      expect(postsSurface).toBeDefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves route components imported through tsconfig path aliases", async () => {
    const fixture = await createRuleFixture(START_DEPENDENCIES);

    try {
      await fixture.write(
        "tsconfig.json",
        `${JSON.stringify(
          {
            compilerOptions: {
              baseUrl: ".",
              jsx: "react-jsx",
              paths: { "~/*": ["./src/*"] },
            },
          },
          null,
          2
        )}\n`
      );
      await fixture.write("src/routes/__root.tsx", ROOT_ROUTE);
      await fixture.write(
        "src/components/home-page.tsx",
        `export function HomePage() {
  return <article aria-label="Aliased home" />;
}
`
      );
      await fixture.write(
        "src/routes/index.tsx",
        `import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "~/components/home-page";

export const Route = createFileRoute("/")({
  component: HomePage,
});
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const homeSurface = graph.surfaces.find(
        (surface) => surface.routeKey === "/"
      );
      const renderedTags =
        homeSurface?.instances.map((instance) => instance.tagName) ?? [];

      expect(renderedTags).toContain("article");
    } finally {
      await fixture.cleanup();
    }
  });

  it("builds an identical graph on repeated runs", async () => {
    const fixture = await createRuleFixture(START_DEPENDENCIES);

    try {
      await fixture.write("src/routes/__root.tsx", ROOT_ROUTE);
      await fixture.write(
        "src/routes/index.tsx",
        `import { createFileRoute } from "@tanstack/react-router";

function Home() {
  return <section aria-label="Home" />;
}

export const Route = createFileRoute("/")({
  component: Home,
});
`
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
