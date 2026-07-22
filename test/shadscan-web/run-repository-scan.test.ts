import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedScanAdmissionController } from "../../lib/shadscan-api/admission";
import { HostedScanError } from "../../lib/shadscan-api/errors";
import type { GitHubTreeEntry } from "../../lib/shadscan-api/github-tree";
import { executeWebRepositoryScan } from "../../lib/shadscan-web/run-repository-scan";
import { createTarGzip } from "../shadscan-api/test-archive";
import { WEB_SCAN_COMPLETE_FIXTURE } from "./fixtures";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

const getFetchUrl = (input: Parameters<typeof fetch>[0]): string =>
  input instanceof Request ? input.url : input.toString();

const blob = (filePath: string, size = 32): GitHubTreeEntry => ({
  mode: "100644",
  path: filePath,
  sha: COMMIT_SHA,
  size,
  type: "blob",
});

const ROOT_PROJECT_TREE = [blob("package.json"), blob("src/App.tsx")];

const createDiscoveryDependencies = (
  treeEntries: GitHubTreeEntry[] = ROOT_PROJECT_TREE
) => ({
  enforceDiscoveryRateLimit: vi.fn(() => Promise.resolve()),
  enforceRateLimit: vi.fn(() => Promise.resolve()),
  loadTree: vi.fn(() => Promise.resolve(treeEntries)),
  resolveSource: vi.fn((repository: string) =>
    Promise.resolve({ commitSha: COMMIT_SHA, repository })
  ),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("executeWebRepositoryScan", () => {
  it("resolves, discovers, materializes, and scans a public GitHub repository", async () => {
    const archive = await createTarGzip([
      {
        contents: `${JSON.stringify({
          dependencies: { react: "19.2.4" },
          name: "web-scan-fixture",
        })}\n`,
        header: {
          name: "acme-widget/package.json",
          type: "file",
        },
      },
      {
        contents: "export const App = () => <main>Fixture</main>;\n",
        header: {
          name: "acme-widget/src/App.tsx",
          type: "file",
        },
      },
    ]);
    const archiveUrl = `https://codeload.github.com/acme/widget/legacy.tar.gz/${COMMIT_SHA}`;
    const fetchImplementation = vi.fn<typeof fetch>((input) => {
      const url = getFetchUrl(input);
      if (url === "https://api.github.com/repos/acme/widget") {
        return Promise.resolve(Response.json({ private: false }));
      }
      if (url === "https://api.github.com/repos/acme/widget/commits/HEAD") {
        return Promise.resolve(Response.json({ sha: COMMIT_SHA }));
      }
      if (
        url ===
        `https://api.github.com/repos/acme/widget/git/trees/${COMMIT_SHA}?recursive=1`
      ) {
        return Promise.resolve(
          Response.json({
            sha: COMMIT_SHA,
            tree: ROOT_PROJECT_TREE,
            truncated: false,
          })
        );
      }
      if (
        url === `https://api.github.com/repos/acme/widget/tarball/${COMMIT_SHA}`
      ) {
        return Promise.resolve(
          new Response(null, {
            headers: { location: archiveUrl },
            status: 302,
          })
        );
      }
      if (url === archiveUrl) {
        return Promise.resolve(new Response(Uint8Array.from(archive)));
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });
    const enforceDiscoveryRateLimit = vi.fn(() => Promise.resolve());
    const enforceRateLimit = vi.fn(() => Promise.resolve());

    const result = await executeWebRepositoryScan(
      {
        clientAddress: "203.0.113.4",
        repositoryInput: "https://github.com/acme/widget",
      },
      {
        enforceDiscoveryRateLimit,
        enforceRateLimit,
        fetchImplementation,
      }
    );

    expect(enforceDiscoveryRateLimit).toHaveBeenCalledOnce();
    expect(enforceRateLimit).toHaveBeenCalledWith({
      clientAddress: "203.0.113.4",
      repositoryKey: "acme/widget",
    });
    expect(result).toMatchObject({
      projectPath: ".",
      repository: "acme/widget",
      repositoryUrl: "https://github.com/acme/widget",
      result: {
        report: {
          packageName: "web-scan-fixture",
          source: {
            digest: `sha256:${createHash("sha256")
              .update(archive)
              .digest("hex")}`,
            kind: "git",
            revision: COMMIT_SHA,
          },
        },
        scan: {
          resolvedRevision: COMMIT_SHA,
          status: "completed",
        },
      },
      status: "complete",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  it("returns project choices without consuming full scan quota", async () => {
    const dependencies = createDiscoveryDependencies([
      blob("package.json"),
      blob("apps/admin/package.json"),
      blob("apps/admin/src/App.tsx"),
      blob("apps/store/package.json"),
      blob("apps/store/src/App.tsx"),
    ]);

    const result = await executeWebRepositoryScan(
      {
        clientAddress: "203.0.113.4",
        repositoryInput: "acme/monorepo",
      },
      dependencies
    );

    expect(result).toEqual({
      projects: [
        { label: "apps/admin", path: "apps/admin" },
        { label: "apps/store", path: "apps/store" },
      ],
      repository: "acme/monorepo",
      repositoryInput: "acme/monorepo",
      repositoryUrl: "https://github.com/acme/monorepo",
      status: "project_selection_required",
    });
    expect(dependencies.enforceDiscoveryRateLimit).toHaveBeenCalledOnce();
    expect(dependencies.enforceRateLimit).not.toHaveBeenCalled();
  });

  it("rejects invalid input before admission, rate limiting, or fetching", async () => {
    const enforceDiscoveryRateLimit = vi.fn(() => Promise.resolve());
    const enforceRateLimit = vi.fn(() => Promise.resolve());
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(
      executeWebRepositoryScan(
        {
          clientAddress: "203.0.113.4",
          repositoryInput: "https://example.com/acme/widget",
        },
        {
          enforceDiscoveryRateLimit,
          enforceRateLimit,
          fetchImplementation,
        }
      )
    ).rejects.toMatchObject({ code: "INVALID_REPOSITORY" });
    expect(enforceDiscoveryRateLimit).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects a cache miss at capacity after discovery but before scan quota", async () => {
    const admissionController = new HostedScanAdmissionController(1);
    const activeOperation = Promise.withResolvers<void>();
    const activeRun = admissionController.run(() => activeOperation.promise);
    const dependencies = createDiscoveryDependencies();

    await expect(
      executeWebRepositoryScan(
        {
          clientAddress: "203.0.113.4",
          repositoryInput: "acme/widget",
        },
        { admissionController, ...dependencies }
      )
    ).rejects.toMatchObject({
      code: "SCAN_BUSY",
      retryAfterSeconds: 5,
      retryable: true,
    });
    expect(dependencies.enforceDiscoveryRateLimit).toHaveBeenCalledOnce();
    expect(dependencies.enforceRateLimit).not.toHaveBeenCalled();

    activeOperation.resolve();
    await activeRun;
  });

  it("serves a validated cache hit without scan admission or full quota", async () => {
    const admissionController = new HostedScanAdmissionController(1);
    const activeOperation = Promise.withResolvers<void>();
    const activeRun = admissionController.run(() => activeOperation.promise);
    const dependencies = createDiscoveryDependencies();
    const readCache = vi.fn(() =>
      Promise.resolve(WEB_SCAN_COMPLETE_FIXTURE.result)
    );

    const result = await executeWebRepositoryScan(
      {
        clientAddress: "203.0.113.4",
        repositoryInput: "acme/widget",
      },
      {
        ...dependencies,
        admissionController,
        cacheConfig: { enabled: true, ttlSeconds: 3600 },
        readCache,
      }
    );

    expect(result).toMatchObject({
      projectPath: ".",
      status: "complete",
    });
    expect(readCache).toHaveBeenCalledWith(
      { enabled: true, ttlSeconds: 3600 },
      {
        commitSha: COMMIT_SHA,
        projectPath: ".",
        repositoryKey: "acme/widget",
      }
    );
    expect(dependencies.enforceRateLimit).not.toHaveBeenCalled();

    activeOperation.resolve();
    await activeRun;
  });

  it("maps private-repository failures from immutable resolution", async () => {
    const dependencies = createDiscoveryDependencies();
    dependencies.resolveSource.mockRejectedValue(
      new HostedScanError("Internal upstream detail", {
        code: "PRIVATE_REPOSITORY_UNSUPPORTED",
        status: 422,
      })
    );

    await expect(
      executeWebRepositoryScan(
        {
          clientAddress: "203.0.113.4",
          repositoryInput: "acme/private-widget",
        },
        dependencies
      )
    ).rejects.toEqual(
      expect.objectContaining({
        code: "PRIVATE_REPOSITORY_UNSUPPORTED",
        message: expect.not.stringContaining("Internal upstream detail"),
      })
    );
  });

  it("maps conflicting archive paths to unsupported source", async () => {
    const dependencies = createDiscoveryDependencies();
    const materializeSource = vi.fn(() =>
      Promise.reject(
        new HostedScanError("The archive contains conflicting paths.", {
          code: "ARCHIVE_PATH_CONFLICT",
          status: 422,
        })
      )
    );

    await expect(
      executeWebRepositoryScan(
        {
          clientAddress: "203.0.113.4",
          repositoryInput: "acme/conflicting-widget",
        },
        { ...dependencies, materializeSource }
      )
    ).rejects.toMatchObject({
      code: "SOURCE_UNSUPPORTED",
      retryable: false,
    });
  });

  it("maps isolated scanner failures to a retryable local fallback", async () => {
    const dependencies = createDiscoveryDependencies();
    const materializeSource = vi.fn(() =>
      Promise.resolve({
        cleanupDirectory: "/tmp/shadscan-test",
        projectRoot: "/tmp/shadscan-test",
        resolvedRevision: null,
        sourceDigest: `sha256:${"a".repeat(64)}`,
        sourceKind: "snapshot" as const,
        sourceRoot: "/tmp/shadscan-test",
      })
    );
    const runScan = vi.fn(() =>
      Promise.reject(
        new HostedScanError("Internal worker detail", {
          code: "SCAN_WORKER_FAILED",
          retryable: true,
          status: 500,
        })
      )
    );

    await expect(
      executeWebRepositoryScan(
        {
          clientAddress: "203.0.113.4",
          repositoryInput: "acme/worker-failure",
        },
        { ...dependencies, materializeSource, runScan }
      )
    ).rejects.toMatchObject({
      code: "SCAN_WORKER_FAILED",
      message: expect.not.stringContaining("Internal worker detail"),
      retryable: true,
    });
  });

  it("aborts and maps scans that exceed the hosted deadline", async () => {
    const dependencies = createDiscoveryDependencies();
    let operationSignal: AbortSignal | undefined;
    const materializeSource = vi.fn(
      (
        _request: unknown,
        _resolvedSource: unknown,
        _fetchImplementation: unknown,
        signal?: AbortSignal
      ) => {
        operationSignal = signal;
        return new Promise<never>(() => undefined);
      }
    );

    await expect(
      executeWebRepositoryScan(
        {
          clientAddress: "203.0.113.4",
          repositoryInput: "acme/slow-widget",
        },
        {
          ...dependencies,
          deadlineMs: 5,
          materializeSource,
        }
      )
    ).rejects.toMatchObject({
      code: "SCAN_TIMEOUT",
      message: expect.stringContaining("too long"),
      retryable: true,
    });
    expect(operationSignal?.aborted).toBe(true);
  });
});
