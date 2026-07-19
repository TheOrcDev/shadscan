import type { FetchHandlerResult } from "next/experimental/testmode/playwright.js";
import { createTarGzip } from "../shadscan-api/test-archive";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

interface GitHubFixtureOptions {
  archive: Buffer;
  repository: string;
  repositoryResponse?: (
    requestCount: number
  ) => FetchHandlerResult | Promise<FetchHandlerResult>;
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

const createGitHubFetchHandler = ({
  archive,
  repository,
  repositoryResponse,
}: GitHubFixtureOptions) => {
  const repositoryUrl = `https://api.github.com/repos/${repository}`;
  const revisionUrl = `${repositoryUrl}/commits/HEAD`;
  const tarballUrl = `${repositoryUrl}/tarball/${COMMIT_SHA}`;
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

export { createGitHubFetchHandler, createReactProjectArchive };
