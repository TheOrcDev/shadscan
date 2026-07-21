import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedScanAdmissionController } from "../../lib/shadscan-api/admission";
import { HostedScanError } from "../../lib/shadscan-api/errors";
import { executeWebRepositoryScan } from "../../lib/shadscan-web/run-repository-scan";
import { createTarGzip } from "../shadscan-api/test-archive";

const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";

const getFetchUrl = (input: Parameters<typeof fetch>[0]): string =>
  input instanceof Request ? input.url : input.toString();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("executeWebRepositoryScan", () => {
  it("resolves, materializes, and scans a public GitHub repository", async () => {
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
    const enforceRateLimit = vi.fn(() => Promise.resolve());

    const result = await executeWebRepositoryScan(
      {
        clientAddress: "203.0.113.4",
        repositoryInput: "https://github.com/acme/widget",
      },
      { enforceRateLimit, fetchImplementation }
    );

    expect(enforceRateLimit).toHaveBeenCalledWith({
      clientAddress: "203.0.113.4",
      repositoryKey: "acme/widget",
    });
    expect(result).toMatchObject({
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
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });

  it("rejects invalid input before rate limiting or fetching", async () => {
    const enforceRateLimit = vi.fn(() => Promise.resolve());
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(
      executeWebRepositoryScan(
        {
          clientAddress: "203.0.113.4",
          repositoryInput: "https://example.com/acme/widget",
        },
        { enforceRateLimit, fetchImplementation }
      )
    ).rejects.toMatchObject({ code: "INVALID_REPOSITORY" });
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects at capacity before consuming scan quota", async () => {
    const admissionController = new HostedScanAdmissionController(1);
    const activeOperation = Promise.withResolvers<void>();
    const activeRun = admissionController.run(() => activeOperation.promise);
    const enforceRateLimit = vi.fn(() => Promise.resolve());

    await expect(
      executeWebRepositoryScan(
        {
          clientAddress: "203.0.113.4",
          repositoryInput: "acme/widget",
        },
        { admissionController, enforceRateLimit }
      )
    ).rejects.toMatchObject({
      code: "SCAN_BUSY",
      retryAfterSeconds: 5,
      retryable: true,
    });
    expect(enforceRateLimit).not.toHaveBeenCalled();

    activeOperation.resolve();
    await activeRun;
  });

  it("maps hosted private-repository failures to the public contract", async () => {
    const materializeSource = vi.fn(() =>
      Promise.reject(
        new HostedScanError("Internal upstream detail", {
          code: "PRIVATE_REPOSITORY_UNSUPPORTED",
          status: 422,
        })
      )
    );

    await expect(
      executeWebRepositoryScan(
        {
          clientAddress: "203.0.113.4",
          repositoryInput: "acme/private-widget",
        },
        {
          enforceRateLimit: () => Promise.resolve(),
          materializeSource,
        }
      )
    ).rejects.toEqual(
      expect.objectContaining({
        code: "PRIVATE_REPOSITORY_UNSUPPORTED",
        message: expect.not.stringContaining("Internal upstream detail"),
      })
    );
  });

  it("maps conflicting archive paths to unsupported source", async () => {
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
        {
          enforceRateLimit: () => Promise.resolve(),
          materializeSource,
        }
      )
    ).rejects.toMatchObject({
      code: "SOURCE_UNSUPPORTED",
      retryable: false,
    });
  });

  it("maps isolated scanner failures to a retryable local fallback", async () => {
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
        {
          enforceRateLimit: () => Promise.resolve(),
          materializeSource,
          runScan,
        }
      )
    ).rejects.toMatchObject({
      code: "SCAN_WORKER_FAILED",
      message: expect.not.stringContaining("Internal worker detail"),
      retryable: true,
    });
  });

  it("aborts and maps scans that exceed the hosted deadline", async () => {
    let operationSignal: AbortSignal | undefined;
    const materializeSource = vi.fn(
      (
        _request: unknown,
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
          deadlineMs: 5,
          enforceRateLimit: () => Promise.resolve(),
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
