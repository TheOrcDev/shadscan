import { describe, expect, it, vi } from "vitest";
import { createScanCacheDescriptor } from "../../lib/shadscan-web/scan-cache";
import {
  type QueueSender,
  SynchronousScanDispatcher,
  VercelQueueScanDispatcher,
} from "../../lib/shadscan-web/scan-dispatcher";
import type { ScanJobCreation } from "../../lib/shadscan-web/scan-jobs";
import { WEB_SCAN_COMPLETE_FIXTURE } from "./fixtures";

const QUEUE_SOURCE_PATTERN = /archive|contents|sourceRoot/;
const JOB_ID = "9e83046c-84aa-4da2-a9ef-ec2b38f7058e";
const CACHE_IDENTITY = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  projectPath: ".",
  repositoryKey: "acme/widget",
};
const ASYNC_CONFIG = {
  enabled: true,
  jobTtlSeconds: 86_400,
  maxAttempts: 5,
  maxConcurrency: 2,
  syncRelevantBytes: 1024,
  syncRelevantFiles: 1,
};

const createDispatchInput = () => ({
  asyncConfig: ASYNC_CONFIG,
  cacheIdentity: CACHE_IDENTITY,
  commitSha: CACHE_IDENTITY.commitSha,
  executeSynchronously: vi.fn(() =>
    Promise.resolve(WEB_SCAN_COMPLETE_FIXTURE.result)
  ),
  projectPath: ".",
  repository: "acme/widget",
});

const createJob = (state: ScanJobCreation["state"] = "queued") => {
  const job: ScanJobCreation = {
    descriptor: createScanCacheDescriptor(CACHE_IDENTITY),
    jobId: JOB_ID,
    jobToken: "a".repeat(64),
    state,
  };
  return vi.fn(() => Promise.resolve(job));
};

describe("scan dispatchers", () => {
  it("executes through the synchronous dispatcher", async () => {
    const input = createDispatchInput();

    await expect(
      new SynchronousScanDispatcher().dispatch(input)
    ).resolves.toEqual({
      kind: "completed",
      result: WEB_SCAN_COMPLETE_FIXTURE.result,
    });
    expect(input.executeSynchronously).toHaveBeenCalledOnce();
  });

  it("publishes immutable coordinates with cache-key idempotency", async () => {
    const sendMessage: QueueSender = vi.fn(() =>
      Promise.resolve({ messageId: "message-1" })
    );
    const input = createDispatchInput();
    const dispatcher = new VercelQueueScanDispatcher(
      sendMessage,
      createJob(),
      vi.fn()
    );

    await expect(dispatcher.dispatch(input)).resolves.toMatchObject({
      jobId: JOB_ID,
      jobToken: "a".repeat(64),
      kind: "queued",
    });
    expect(input.executeSynchronously).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledOnce();
    const [topic, message, options] =
      vi.mocked(sendMessage).mock.calls[0] ?? [];
    expect(topic).toBe("shadscan-scans");
    expect(options).toMatchObject({
      idempotencyKey: createScanCacheDescriptor(CACHE_IDENTITY).cacheKey,
      retentionSeconds: 86_400,
    });
    expect(message).toMatchObject({
      commitSha: CACHE_IDENTITY.commitSha,
      jobId: JOB_ID,
      projectPath: ".",
      repository: "acme/widget",
    });
    expect(JSON.stringify(message)).not.toMatch(QUEUE_SOURCE_PATTERN);
  });

  it("does not republish a canonical job that already has a cached result", async () => {
    const sendMessage: QueueSender = vi.fn();
    const dispatcher = new VercelQueueScanDispatcher(
      sendMessage,
      createJob("completed"),
      vi.fn()
    );

    await dispatcher.dispatch(createDispatchInput());

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("marks a job terminal when the provider rejects publication", async () => {
    const sendMessage: QueueSender = vi.fn(() =>
      Promise.reject(new Error("queue unavailable"))
    );
    const recordFailure = vi.fn(() => Promise.resolve());
    const dispatcher = new VercelQueueScanDispatcher(
      sendMessage,
      createJob(),
      recordFailure
    );

    await expect(
      dispatcher.dispatch(createDispatchInput())
    ).rejects.toMatchObject({
      code: "ASYNC_QUEUE_UNAVAILABLE",
    });
    expect(recordFailure).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ code: "SERVICE_NOT_CONFIGURED" }),
      false,
      5
    );
  });
});
