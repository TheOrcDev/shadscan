import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubScanRequestSchema } from "../../lib/shadscan-api/contracts";
import {
  fetchGitHubArchiveResponse,
  loadGitHubRepositoryTree,
  materializeResolvedGitHubSource,
  resolvePublicGitHubSource,
} from "../../lib/shadscan-api/github-source";
import { createSparseSourceDigest } from "../../lib/shadscan-api/github-sparse-source";
import {
  type GitHubTreeEntry,
  getRetainedGitHubTreeEntries,
} from "../../lib/shadscan-api/github-tree";
import { cleanupMaterializationDirectory } from "../../lib/shadscan-api/materialized-project";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const TREE_SHA_1 = "1123456789abcdef0123456789abcdef01234567";
const TREE_SHA_2 = "2123456789abcdef0123456789abcdef01234567";
const TREE_SHA_3 = "3123456789abcdef0123456789abcdef01234567";

const getFetchUrl = (input: Parameters<typeof fetch>[0]): string =>
  input instanceof Request ? input.url : input.toString();

const createEntry = (
  filePath: string,
  sha: string,
  type: GitHubTreeEntry["type"] = "blob",
  size?: number
): GitHubTreeEntry => ({
  mode: type === "tree" ? "040000" : "100644",
  path: filePath,
  sha,
  ...(size === undefined ? {} : { size }),
  type,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GitHub source acquisition", () => {
  it("resolves a revision without downloading oversized commit metadata", async () => {
    const oversizedCommitJson = JSON.stringify({
      files: [{ patch: "x".repeat(70 * 1024) }],
      sha: COMMIT_SHA,
    });
    const fetchImplementation = vi.fn<typeof fetch>((input, init) => {
      const url = getFetchUrl(input);
      if (url === "https://api.github.com/repos/acme/large-commit") {
        return Promise.resolve(Response.json({ private: false }));
      }
      if (
        url === "https://api.github.com/repos/acme/large-commit/commits/HEAD"
      ) {
        const accept = new Headers(init?.headers).get("accept");
        return Promise.resolve(
          accept === "application/vnd.github.sha"
            ? new Response(COMMIT_SHA)
            : new Response(oversizedCommitJson, {
                headers: {
                  "content-length":
                    Buffer.byteLength(oversizedCommitJson).toString(),
                  "content-type": "application/json",
                },
              })
        );
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    const resolved = await resolvePublicGitHubSource(
      "acme/large-commit",
      "HEAD",
      fetchImplementation
    );

    expect(resolved).toEqual({
      commitSha: COMMIT_SHA,
      repository: "acme/large-commit",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const revisionRequest = fetchImplementation.mock.calls[1];
    expect(new Headers(revisionRequest?.[1]?.headers).get("accept")).toBe(
      "application/vnd.github.sha"
    );
  });

  it("classifies an oversized commit revision as a terminal upstream response", async () => {
    const oversizedCommitSha = "a".repeat(65);
    const fetchImplementation = vi.fn<typeof fetch>((input) => {
      const url = getFetchUrl(input);
      if (url === "https://api.github.com/repos/acme/invalid-revision") {
        return Promise.resolve(Response.json({ private: false }));
      }
      if (
        url ===
        "https://api.github.com/repos/acme/invalid-revision/commits/HEAD"
      ) {
        return Promise.resolve(
          new Response(oversizedCommitSha, {
            headers: {
              "content-length": oversizedCommitSha.length.toString(),
              "x-github-request-id": "ABCD:1234:EFGH:5678",
            },
          })
        );
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    await expect(
      resolvePublicGitHubSource(
        "acme/invalid-revision",
        "HEAD",
        fetchImplementation
      )
    ).rejects.toMatchObject({
      code: "GITHUB_INVALID_RESPONSE",
      diagnostics: {
        kind: "upstream_response_too_large",
        limitBytes: 64,
        observedBytes: 65,
        stage: "resolve_revision",
        upstreamRequestId: "ABCD:1234:EFGH:5678",
        upstreamStatus: 200,
      },
      retryable: false,
      status: 502,
    });
  });

  it("authenticates the archive API request but not its codeload redirect", async () => {
    vi.stubEnv("GITHUB_TOKEN", "server-side-github-token");
    const archiveUrl = `https://codeload.github.com/acme/widget/legacy.tar.gz/${COMMIT_SHA}`;
    const fetchImplementation = vi.fn<typeof fetch>((input, init) => {
      const url = getFetchUrl(input);
      const authorization = new Headers(init?.headers).get("authorization");
      if (
        url === `https://api.github.com/repos/acme/widget/tarball/${COMMIT_SHA}`
      ) {
        expect(authorization).toBe("Bearer server-side-github-token");
        return Promise.resolve(
          new Response(null, {
            headers: { location: archiveUrl },
            status: 302,
          })
        );
      }
      if (url === archiveUrl) {
        expect(authorization).toBeNull();
        return Promise.resolve(new Response("archive"));
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    const response = await fetchGitHubArchiveResponse(
      "acme/widget",
      COMMIT_SHA,
      fetchImplementation,
      AbortSignal.timeout(1000)
    );

    expect(await response.text()).toBe("archive");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("completes a truncated recursive tree through bounded subtree traversal", async () => {
    const fetchImplementation = vi.fn<typeof fetch>((input) => {
      const url = getFetchUrl(input);
      if (url.endsWith(`/git/trees/${COMMIT_SHA}?recursive=1`)) {
        return Promise.resolve(
          Response.json({ sha: COMMIT_SHA, tree: [], truncated: true })
        );
      }
      if (url.endsWith(`/git/trees/${COMMIT_SHA}`)) {
        return Promise.resolve(
          Response.json({
            sha: COMMIT_SHA,
            tree: [
              createEntry("package.json", TREE_SHA_1, "blob", 40),
              createEntry("apps", TREE_SHA_1, "tree"),
            ],
            truncated: false,
          })
        );
      }
      if (url.endsWith(`/git/trees/${TREE_SHA_1}`)) {
        return Promise.resolve(
          Response.json({
            sha: TREE_SHA_1,
            tree: [createEntry("web", TREE_SHA_2, "tree")],
            truncated: false,
          })
        );
      }
      if (url.endsWith(`/git/trees/${TREE_SHA_2}`)) {
        return Promise.resolve(
          Response.json({
            sha: TREE_SHA_2,
            tree: [
              createEntry("package.json", TREE_SHA_2, "blob", 40),
              createEntry("src", TREE_SHA_3, "tree"),
            ],
            truncated: false,
          })
        );
      }
      if (url.endsWith(`/git/trees/${TREE_SHA_3}`)) {
        return Promise.resolve(
          Response.json({
            sha: TREE_SHA_3,
            tree: [createEntry("App.tsx", TREE_SHA_3, "blob", 20)],
            truncated: false,
          })
        );
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    const entries = await loadGitHubRepositoryTree(
      "acme/monorepo",
      COMMIT_SHA,
      20,
      fetchImplementation
    );

    expect(entries.map((entry) => entry.path)).toEqual([
      "apps",
      "apps/web",
      "apps/web/package.json",
      "apps/web/src",
      "apps/web/src/App.tsx",
      "package.json",
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  it("returns exact tree-entry telemetry when recursive metadata is over budget", async () => {
    const tree = [
      createEntry("a.ts", TREE_SHA_1, "blob", 1),
      createEntry("b.ts", TREE_SHA_2, "blob", 1),
      createEntry("c.ts", TREE_SHA_3, "blob", 1),
    ];
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({ sha: COMMIT_SHA, tree, truncated: false })
      )
    );

    await expect(
      loadGitHubRepositoryTree("acme/large", COMMIT_SHA, 2, fetchImplementation)
    ).rejects.toMatchObject({
      code: "ARCHIVE_TOO_MANY_ENTRIES",
      sourceLimit: {
        kind: "archive_entries",
        limit: 2,
        observed: 3,
        unit: "entries",
      },
    });
  });

  it("materializes only selected sparse blobs and path-only markers", async () => {
    const fileContents = new Map<string, Buffer>([
      [TREE_SHA_1, Buffer.from('{"name":"workspace"}\n')],
      [TREE_SHA_2, Buffer.from("lockfileVersion: '9.0'\n")],
      [
        TREE_SHA_3,
        Buffer.from('{"name":"web","dependencies":{"react":"19.2.4"}}\n'),
      ],
      [COMMIT_SHA, Buffer.from("export const App = () => <main />;\n")],
    ]);
    const entries: GitHubTreeEntry[] = [
      createEntry(
        "package.json",
        TREE_SHA_1,
        "blob",
        fileContents.get(TREE_SHA_1)?.byteLength
      ),
      createEntry(
        "pnpm-lock.yaml",
        TREE_SHA_2,
        "blob",
        fileContents.get(TREE_SHA_2)?.byteLength
      ),
      createEntry(
        "apps/web/package.json",
        TREE_SHA_3,
        "blob",
        fileContents.get(TREE_SHA_3)?.byteLength
      ),
      createEntry(
        "apps/web/src/App.tsx",
        COMMIT_SHA,
        "blob",
        fileContents.get(COMMIT_SHA)?.byteLength
      ),
      createEntry("apps/web/public/favicon.ico", TREE_SHA_1, "blob", 500),
      createEntry("apps/admin/src/App.tsx", TREE_SHA_2, "blob", 20),
    ];
    const fetchImplementation = vi.fn<typeof fetch>((input) => {
      const url = getFetchUrl(input);
      const sha = url.split("/").at(-1) ?? "";
      const contents = fileContents.get(sha);
      if (!contents) {
        throw new Error(`Unexpected GitHub blob request: ${url}`);
      }
      return Promise.resolve(new Response(Uint8Array.from(contents)));
    });
    const request = GitHubScanRequestSchema.parse({
      source: {
        kind: "github",
        repository: "acme/monorepo",
        revision: "HEAD",
        subdirectory: "apps/web",
      },
    });

    const source = await materializeResolvedGitHubSource(
      request,
      { commitSha: COMMIT_SHA, repository: "acme/monorepo" },
      fetchImplementation,
      undefined,
      { sourceMode: "auto", treeEntries: entries }
    );

    try {
      expect(
        await readFile(path.join(source.projectRoot, "src/App.tsx"), "utf8")
      ).toContain("export const App");
      expect(
        (await stat(path.join(source.projectRoot, "public/favicon.ico"))).size
      ).toBe(0);
      await expect(
        stat(path.join(source.sourceRoot, "apps/admin/src/App.tsx"))
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(source.sourceDigest).toBe(
        createSparseSourceDigest(
          getRetainedGitHubTreeEntries(entries, "apps/web")
        )
      );
      expect(fetchImplementation).toHaveBeenCalledTimes(4);
    } finally {
      await cleanupMaterializationDirectory(source.cleanupDirectory);
    }
  });
});
