import { describe, expect, it, vi } from "vitest";
import { HostedScanError } from "../../lib/shadscan-api/errors";
import {
  type ProcessQueuedScanDependencies,
  processQueuedScan,
  QueuedScanRetryError,
} from "../../lib/shadscan-web/process-queued-scan";
import { createScanCacheDescriptor } from "../../lib/shadscan-web/scan-cache";
import { DEFAULT_WEB_SOURCE_LIMITS } from "../../lib/shadscan-web/source-config";
import { WEB_SCAN_COMPLETE_FIXTURE } from "./fixtures";

const JOB_ID = "9e83046c-84aa-4da2-a9ef-ec2b38f7058e";
const COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
const CACHE_IDENTITY = {
  commitSha: COMMIT_SHA,
  projectPath: ".",
  repositoryKey: "acme/widget",
};
const CACHE_KEY = createScanCacheDescriptor(CACHE_IDENTITY).cacheKey;
const MESSAGE = {
  cacheKey: CACHE_KEY,
  commitSha: COMMIT_SHA,
  jobId: JOB_ID,
  projectPath: ".",
  repository: "acme/widget",
  schemaVersion: 1 as const,
};
const TREE = [
  {
    mode: "100644",
    path: "package.json",
    sha: "1".repeat(40),
    size: 100,
    type: "blob" as const,
  },
  {
    mode: "100644",
    path: "src/App.tsx",
    sha: "2".repeat(40),
    size: 100,
    type: "blob" as const,
  },
];
const ASYNC_CONFIG = {
  enabled: true,
  jobTtlSeconds: 86_400,
  maxAttempts: 5,
  maxConcurrency: 2,
  syncRelevantBytes: 1024,
  syncRelevantFiles: 1,
};

const createDependencies = (): ProcessQueuedScanDependencies => ({
  asyncConfig: ASYNC_CONFIG,
  cacheConfig: { enabled: true, ttlSeconds: 3600 },
  claimJob: vi.fn(() =>
    Promise.resolve({
      action: "claimed" as const,
      attempts: 1,
      cacheKey: CACHE_KEY,
    })
  ),
  completeJob: vi.fn(() => Promise.resolve()),
  loadTree: vi.fn(() => Promise.resolve(TREE)),
  materializeSource: vi.fn(() =>
    Promise.resolve({
      category: undefined,
      cleanupDirectory: "/tmp/shadscan-test",
      projectRoot: "/tmp/shadscan-test/source",
      resolvedRevision: COMMIT_SHA,
      sourceDigest: `sha256:${"a".repeat(64)}`,
      sourceKind: "git" as const,
      sourceRoot: "/tmp/shadscan-test/source",
    })
  ),
  recordFailure: vi.fn(() => Promise.resolve()),
  resolveSource: vi.fn(() =>
    Promise.resolve({ commitSha: COMMIT_SHA, repository: "acme/widget" })
  ),
  runScan: vi.fn(() => Promise.resolve(WEB_SCAN_COMPLETE_FIXTURE.result)),
  signal: new AbortController().signal,
  sourceConfig: { limits: DEFAULT_WEB_SOURCE_LIMITS, mode: "auto" },
  writeCache: vi.fn(() => Promise.resolve()),
});

describe("processQueuedScan", () => {
  it("writes one validated cache result and completes the claimed job", async () => {
    const dependencies = createDependencies();

    await expect(processQueuedScan(MESSAGE, dependencies)).resolves.toBe(
      "completed"
    );
    expect(dependencies.writeCache).toHaveBeenCalledWith(
      CACHE_IDENTITY,
      WEB_SCAN_COMPLETE_FIXTURE.result,
      3600
    );
    expect(dependencies.completeJob).toHaveBeenCalledWith(JOB_ID, CACHE_KEY);
  });

  it("converges duplicate delivery on an existing cached result", async () => {
    const dependencies = createDependencies();
    dependencies.claimJob = vi.fn(() =>
      Promise.resolve({
        action: "completed" as const,
        attempts: 1,
        cacheKey: CACHE_KEY,
      })
    );

    await expect(processQueuedScan(MESSAGE, dependencies)).resolves.toBe(
      "completed"
    );
    expect(dependencies.resolveSource).not.toHaveBeenCalled();
    expect(dependencies.runScan).not.toHaveBeenCalled();
  });

  it("retries after lease contention without performing source work", async () => {
    const dependencies = createDependencies();
    dependencies.claimJob = vi.fn(() =>
      Promise.resolve({
        action: "busy" as const,
        attempts: 0,
        cacheKey: CACHE_KEY,
      })
    );

    await expect(
      processQueuedScan(MESSAGE, dependencies)
    ).rejects.toBeInstanceOf(QueuedScanRetryError);
    expect(dependencies.resolveSource).not.toHaveBeenCalled();
  });

  it("records retryable worker failure and asks the queue to redeliver", async () => {
    const dependencies = createDependencies();
    dependencies.resolveSource = vi.fn(() =>
      Promise.reject(
        new HostedScanError("GitHub timed out.", {
          code: "GITHUB_TIMEOUT",
          retryable: true,
          status: 504,
        })
      )
    );

    await expect(
      processQueuedScan(MESSAGE, dependencies)
    ).rejects.toBeInstanceOf(QueuedScanRetryError);
    expect(dependencies.recordFailure).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ retryable: true }),
      true,
      5
    );
  });

  it("acknowledges a terminal source contract failure", async () => {
    const dependencies = createDependencies();
    dependencies.loadTree = vi.fn(() => Promise.resolve([]));

    await expect(processQueuedScan(MESSAGE, dependencies)).resolves.toBe(
      "terminal"
    );
    expect(dependencies.recordFailure).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ retryable: false }),
      false,
      5
    );
  });

  it("acknowledges malformed queue payloads without touching Neon", async () => {
    const dependencies = createDependencies();

    await expect(
      processQueuedScan({ jobId: JOB_ID }, dependencies)
    ).resolves.toBe("discarded");
    expect(dependencies.claimJob).not.toHaveBeenCalled();
  });
});
