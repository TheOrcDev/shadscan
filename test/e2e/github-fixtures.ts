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
      return Response.json({ sha: COMMIT_SHA });
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
  createGitHubFetchHandler,
  createMonorepoProjectArchive,
  createReactProjectArchive,
  MONOREPO_PROJECT_TREE,
};
