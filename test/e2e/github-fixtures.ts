import type { FetchHandlerResult } from "next/experimental/testmode/playwright.js";
import { createTarGzip } from "../shadscan-api/test-archive";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const ROOT_PROJECT_TREE = [
  "package.json",
  "components.json",
  "app/layout.tsx",
  "app/page.tsx",
].map((path) => ({
  mode: "100644",
  path,
  sha: COMMIT_SHA,
  size: 256,
  type: "blob",
}));

interface GitHubFixtureOptions {
  archive: Buffer;
  repository: string;
  repositoryResponse?: (
    requestCount: number
  ) => FetchHandlerResult | Promise<FetchHandlerResult>;
  tree?: typeof ROOT_PROJECT_TREE;
}

const createReactProjectArchive = (): Promise<Buffer> =>
  createTarGzip([
    {
      contents: `${JSON.stringify(
        {
          dependencies: {
            next: "16.2.10",
            react: "19.2.4",
            "react-dom": "19.2.4",
          },
          name: "shadscan-e2e-fixture",
          packageManager: "pnpm@10.16.0",
        },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/package.json", type: "file" },
    },
    {
      contents: `${JSON.stringify(
        {
          aliases: {
            components: "@/components",
            ui: "@/components/ui",
          },
          rsc: true,
          style: "new-york",
        },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/components.json", type: "file" },
    },
    {
      contents:
        'export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }\n',
      header: { name: "shadscan-e2e/app/layout.tsx", type: "file" },
    },
    {
      contents:
        'export default function Page() { return <main><h1>Fixture project</h1><button type="button">Save</button></main>; }\n',
      header: { name: "shadscan-e2e/app/page.tsx", type: "file" },
    },
  ]);

const createTanstackStartProjectArchive = (): Promise<Buffer> =>
  createTarGzip([
    {
      contents: `${JSON.stringify(
        {
          dependencies: {
            "@tanstack/react-router": "1.130.2",
            "@tanstack/react-start": "1.131.7",
            react: "19.2.4",
            "react-dom": "19.2.4",
          },
          name: "shadscan-e2e-start-fixture",
          packageManager: "pnpm@10.16.0",
        },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/package.json", type: "file" },
    },
    {
      contents: `${JSON.stringify(
        {
          aliases: {
            components: "~/components",
            ui: "~/components/ui",
          },
          style: "new-york",
        },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/components.json", type: "file" },
    },
    {
      contents:
        'import { createRootRoute, Outlet } from "@tanstack/react-router";\n\nfunction RootDocument() {\n  return (\n    <html lang="en">\n      <body>\n        <main>\n          <Outlet />\n        </main>\n      </body>\n    </html>\n  );\n}\n\nexport const Route = createRootRoute({\n  head: () => ({ meta: [{ title: "Start fixture" }] }),\n  component: RootDocument,\n});\n',
      header: { name: "shadscan-e2e/src/routes/__root.tsx", type: "file" },
    },
    {
      contents:
        'import { createFileRoute } from "@tanstack/react-router";\n\nfunction Home() {\n  return (\n    <section>\n      <h1>Start fixture</h1>\n      <button type="button">Save</button>\n    </section>\n  );\n}\n\nexport const Route = createFileRoute("/")({\n  component: Home,\n});\n',
      header: { name: "shadscan-e2e/src/routes/index.tsx", type: "file" },
    },
  ]);

const createLaravelInertiaProjectArchive = (): Promise<Buffer> =>
  createTarGzip([
    {
      contents: `${JSON.stringify(
        {
          dependencies: {
            "@inertiajs/react": "2.0.11",
            react: "19.2.4",
            "react-dom": "19.2.4",
          },
          devDependencies: {
            "laravel-vite-plugin": "1.3.0",
            vite: "7.2.0",
          },
          name: "shadscan-e2e-laravel-fixture",
        },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/package.json", type: "file" },
    },
    {
      contents: `${JSON.stringify(
        { require: { "laravel/framework": "^12.0" } },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/composer.json", type: "file" },
    },
    {
      contents: "#!/usr/bin/env php\n",
      header: { name: "shadscan-e2e/artisan", type: "file" },
    },
    {
      contents: `${JSON.stringify(
        {
          aliases: { components: "@/components", ui: "@/components/ui" },
          style: "new-york",
        },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/components.json", type: "file" },
    },
    {
      contents:
        '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <title inertia>Laravel fixture</title>\n    @inertiaHead\n  </head>\n  <body>@inertia</body>\n</html>\n',
      header: {
        name: "shadscan-e2e/resources/views/app.blade.php",
        type: "file",
      },
    },
    {
      contents:
        'export default function Dashboard() {\n  return (\n    <main>\n      <h1>Dashboard</h1>\n      <button type="button">Save</button>\n    </main>\n  );\n}\n',
      header: {
        name: "shadscan-e2e/resources/js/pages/dashboard.tsx",
        type: "file",
      },
    },
  ]);

const createAstroProjectArchive = (): Promise<Buffer> =>
  createTarGzip([
    {
      contents: `${JSON.stringify(
        {
          dependencies: {
            "@astrojs/react": "4.4.0",
            astro: "5.16.2",
            react: "19.2.4",
            "react-dom": "19.2.4",
          },
          name: "shadscan-e2e-astro-fixture",
          packageManager: "pnpm@10.16.0",
        },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/package.json", type: "file" },
    },
    {
      contents: `${JSON.stringify(
        {
          aliases: { components: "@/components", ui: "@/components/ui" },
          style: "new-york",
        },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/components.json", type: "file" },
    },
    {
      contents:
        '---\nimport Counter from "../components/counter";\n---\n<html lang="en">\n  <head>\n    <title>Astro fixture</title>\n  </head>\n  <body>\n    <Counter client:load />\n  </body>\n</html>\n',
      header: { name: "shadscan-e2e/src/pages/index.astro", type: "file" },
    },
    {
      contents:
        'export default function Counter() {\n  return (\n    <main>\n      <h1>Astro fixture</h1>\n      <button type="button">Add</button>\n    </main>\n  );\n}\n',
      header: { name: "shadscan-e2e/src/components/counter.tsx", type: "file" },
    },
  ]);

const createReactRouterProjectArchive = (): Promise<Buffer> =>
  createTarGzip([
    {
      contents: `${JSON.stringify(
        {
          dependencies: {
            react: "19.2.4",
            "react-dom": "19.2.4",
            "react-router": "7.9.1",
          },
          devDependencies: { "@react-router/dev": "7.9.1", vite: "7.2.0" },
          name: "shadscan-e2e-react-router-fixture",
          packageManager: "pnpm@10.16.0",
        },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/package.json", type: "file" },
    },
    {
      contents: "export default { ssr: true };\n",
      header: { name: "shadscan-e2e/react-router.config.ts", type: "file" },
    },
    {
      contents: `${JSON.stringify(
        {
          aliases: { components: "~/components", ui: "~/components/ui" },
          style: "new-york",
        },
        null,
        2
      )}\n`,
      header: { name: "shadscan-e2e/components.json", type: "file" },
    },
    {
      contents:
        'import { Links, Meta, Outlet, Scripts } from "react-router";\n\nexport function meta() {\n  return [{ title: "Router fixture" }];\n}\n\nexport function Layout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="en">\n      <head>\n        <Meta />\n        <Links />\n      </head>\n      <body>\n        {children}\n        <Scripts />\n      </body>\n    </html>\n  );\n}\n\nexport default function App() {\n  return <Outlet />;\n}\n',
      header: { name: "shadscan-e2e/app/root.tsx", type: "file" },
    },
    {
      contents:
        'import { index } from "@react-router/dev/routes";\n\nexport default [index("routes/home.tsx")];\n',
      header: { name: "shadscan-e2e/app/routes.ts", type: "file" },
    },
    {
      contents:
        'export default function Home() {\n  return (\n    <main>\n      <h1>Router fixture</h1>\n      <button type="button">Save</button>\n    </main>\n  );\n}\n',
      header: { name: "shadscan-e2e/app/routes/home.tsx", type: "file" },
    },
  ]);

const MONOREPO_PROJECT_TREE = [
  "package.json",
  "apps/admin/package.json",
  "apps/admin/src/App.tsx",
  "apps/store/package.json",
  "apps/store/src/App.tsx",
].map((path) => ({
  mode: "100644",
  path,
  sha: COMMIT_SHA,
  size: 256,
  type: "blob",
}));

const createMonorepoProjectArchive = (): Promise<Buffer> =>
  createTarGzip([
    {
      contents: '{"name":"workspace","private":true}\n',
      header: { name: "shadscan-e2e/package.json", type: "file" },
    },
    {
      contents: '{"name":"admin","dependencies":{"react":"19.2.4"}}\n',
      header: {
        name: "shadscan-e2e/apps/admin/package.json",
        type: "file",
      },
    },
    {
      contents: "export const App = () => <main>Admin</main>;\n",
      header: {
        name: "shadscan-e2e/apps/admin/src/App.tsx",
        type: "file",
      },
    },
    {
      contents: '{"name":"store","dependencies":{"react":"19.2.4"}}\n',
      header: {
        name: "shadscan-e2e/apps/store/package.json",
        type: "file",
      },
    },
    {
      contents: "export const App = () => <main>Store</main>;\n",
      header: {
        name: "shadscan-e2e/apps/store/src/App.tsx",
        type: "file",
      },
    },
  ]);

const createGitHubFetchHandler = ({
  archive,
  repository,
  repositoryResponse,
  tree = ROOT_PROJECT_TREE,
}: GitHubFixtureOptions) => {
  const repositoryUrl = `https://api.github.com/repos/${repository}`;
  const revisionUrl = `${repositoryUrl}/commits/HEAD`;
  const tarballUrl = `${repositoryUrl}/tarball/${COMMIT_SHA}`;
  const treeUrl = `${repositoryUrl}/git/trees/${COMMIT_SHA}?recursive=1`;
  const archiveUrl = `https://codeload.github.com/${repository}/legacy.tar.gz/${COMMIT_SHA}`;
  let repositoryRequestCount = 0;

  return async (request: Request): Promise<FetchHandlerResult> => {
    if (request.url === repositoryUrl) {
      repositoryRequestCount += 1;
      return (
        (await repositoryResponse?.(repositoryRequestCount)) ??
        Response.json({ private: false })
      );
    }

    if (request.url === revisionUrl) {
      return new Response(COMMIT_SHA);
    }

    if (request.url === treeUrl) {
      return Response.json({
        sha: COMMIT_SHA,
        tree,
        truncated: false,
      });
    }

    if (request.url === tarballUrl) {
      return new Response(null, {
        headers: { location: archiveUrl },
        status: 302,
      });
    }

    if (request.url === archiveUrl) {
      return new Response(Uint8Array.from(archive), {
        headers: { "content-type": "application/gzip" },
      });
    }

    return "abort";
  };
};

export {
  createAstroProjectArchive,
  createGitHubFetchHandler,
  createLaravelInertiaProjectArchive,
  createMonorepoProjectArchive,
  createReactProjectArchive,
  createReactRouterProjectArchive,
  createTanstackStartProjectArchive,
  MONOREPO_PROJECT_TREE,
};
