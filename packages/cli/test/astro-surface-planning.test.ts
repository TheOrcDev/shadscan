import { describe, expect, it } from "vitest";
import { buildComponentRenderGraph } from "../src/component-render-graph";
import { discoverProject } from "../src/discovery";
import { createRuleFixture } from "./rule-fixture";

const ASTRO_DEPENDENCIES = {
  "@astrojs/react": "4.4.0",
  astro: "5.16.2",
  react: "19.2.4",
};

const buildGraph = async (rootDir: string) => {
  const project = await discoverProject(rootDir, { filesystemRoot: rootDir });
  return buildComponentRenderGraph(project, rootDir);
};

describe("astro surface planning", () => {
  it("seeds surfaces from islands rendered by pages and layouts", async () => {
    const fixture = await createRuleFixture(ASTRO_DEPENDENCIES);

    try {
      await fixture.write(
        "src/components/counter.tsx",
        `export default function Counter() {
  return (
    <section aria-label="Counter">
      <button type="button">Add</button>
    </section>
  );
}
`
      );
      await fixture.write(
        "src/layouts/Layout.astro",
        `---
import { SiteNav } from "../components/site-nav";
---
<html lang="en">
  <body>
    <SiteNav client:load />
    <slot />
  </body>
</html>
`
      );
      await fixture.write(
        "src/components/site-nav.tsx",
        `export function SiteNav() {
  return <nav aria-label="Primary" />;
}
`
      );
      await fixture.write(
        "src/pages/index.astro",
        `---
import Layout from "../layouts/Layout.astro";
import Counter from "../components/counter";
---
<Layout>
  <Counter client:visible />
</Layout>
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const astroSurfaces = graph.surfaces.filter(
        (surface) => surface.adapter === "astro-react"
      );
      const routeKeys = astroSurfaces.map((surface) => surface.routeKey);
      const renderedTags = astroSurfaces.flatMap((surface) =>
        surface.instances.map((instance) => instance.tagName)
      );

      expect(routeKeys).toEqual(expect.arrayContaining(["/", "layout:Layout"]));
      expect(renderedTags).toEqual(
        expect.arrayContaining(["section", "button", "nav"])
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves islands imported through the @ alias", async () => {
    const fixture = await createRuleFixture(ASTRO_DEPENDENCIES);

    try {
      await fixture.write(
        "src/components/stat-card.tsx",
        `export function StatCard() {
  return <article aria-label="Stat" />;
}
`
      );
      await fixture.write(
        "src/pages/index.astro",
        `---
import { StatCard } from "@/components/stat-card";
---
<StatCard client:load />
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const home = graph.surfaces.find((surface) => surface.routeKey === "/");
      const renderedTags =
        home?.instances.map((instance) => instance.tagName) ?? [];

      expect(renderedTags).toContain("article");
    } finally {
      await fixture.cleanup();
    }
  });

  it("counts server-rendered islands without client directives", async () => {
    const fixture = await createRuleFixture(ASTRO_DEPENDENCIES);

    try {
      await fixture.write(
        "src/components/hero-copy.tsx",
        `export function HeroCopy() {
  return <header aria-label="Hero" />;
}
`
      );
      await fixture.write(
        "src/pages/index.astro",
        `---
import { HeroCopy } from "../components/hero-copy";
---
<HeroCopy />
`
      );

      const graph = await buildGraph(fixture.rootDir);
      const home = graph.surfaces.find((surface) => surface.routeKey === "/");

      expect(
        home?.instances.map((instance) => instance.tagName) ?? []
      ).toContain("header");
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a graph boundary when mdx pages exist", async () => {
    const fixture = await createRuleFixture(ASTRO_DEPENDENCIES);

    try {
      await fixture.write(
        "src/pages/index.astro",
        "---\n---\n<html><body>hi</body></html>\n"
      );
      await fixture.write("src/pages/blog/post.mdx", "# Post\n");

      const graph = await buildGraph(fixture.rootDir);

      expect(graph.boundaryReasons.join("\n")).toContain(
        "MDX pages are not statically expanded"
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("builds an identical graph on repeated runs", async () => {
    const fixture = await createRuleFixture(ASTRO_DEPENDENCIES);

    try {
      await fixture.write(
        "src/components/widget.tsx",
        'export function Widget() { return <aside aria-label="Widget" />; }\n'
      );
      await fixture.write(
        "src/pages/index.astro",
        `---
import { Widget } from "../components/widget";
---
<Widget client:idle />
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
