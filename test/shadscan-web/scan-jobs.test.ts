import { describe, expect, it, vi } from "vitest";
import {
  type CreateScanJobArguments,
  claimScanJob,
  createScanJob,
  getScanJobStatus,
  hashScanJobToken,
  JOB_LEASE_SECONDS,
  recordScanJobFailure,
} from "../../lib/shadscan-web/scan-jobs";
import { WEB_SCAN_COMPLETE_FIXTURE } from "./fixtures";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const SCAN_ID_PATTERN = /^scan_[a-f0-9]{32}$/;
const JOB_ID = "9e83046c-84aa-4da2-a9ef-ec2b38f7058e";
const CACHE_IDENTITY = {
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  projectPath: ".",
  repositoryKey: "acme/widget",
};

describe("scan jobs", () => {
  it("creates opaque bearer access for a canonical cache identity", async () => {
    let capturedArguments: CreateScanJobArguments | undefined;
    const job = await createScanJob(CACHE_IDENTITY, 3600, (arguments_) => {
      capturedArguments = arguments_;
      return Promise.resolve([
        { resolved_job_id: JOB_ID, resolved_state: "queued" },
      ]);
    });

    expect(job).toMatchObject({
      jobId: JOB_ID,
      state: "queued",
    });
    expect(job.jobToken).toMatch(SHA256_HEX_PATTERN);
    expect(capturedArguments).toMatchObject({
      jobId: expect.any(String),
      jobTokenHash: hashScanJobToken(job.jobToken),
      ttlSeconds: 3600,
    });
    expect(capturedArguments?.descriptor.cacheKey).toMatch(SHA256_HEX_PATTERN);
    expect(capturedArguments?.descriptor).not.toHaveProperty("repositoryKey");
  });

  it("returns no status when a bearer token is rejected", async () => {
    const execute = vi.fn(() => Promise.resolve([]));

    await expect(
      getScanJobStatus(JOB_ID, "a".repeat(64), execute)
    ).resolves.toBe(undefined);
    expect(execute).toHaveBeenCalledWith(
      JOB_ID,
      hashScanJobToken("a".repeat(64))
    );
  });

  it("validates cached results and assigns a fresh scan ID", async () => {
    const status = await getScanJobStatus(JOB_ID, "b".repeat(64), () =>
      Promise.resolve([
        {
          job_state: "completed",
          payload: WEB_SCAN_COMPLETE_FIXTURE.result,
          terminal_error: null,
        },
      ])
    );

    expect(status).toMatchObject({ status: "complete" });
    if (status?.status !== "complete") {
      throw new Error("Expected a completed queued scan.");
    }
    expect(status.result.scan.id).toMatch(SCAN_ID_PATTERN);
    expect(status.result.scan.id).not.toBe(
      WEB_SCAN_COMPLETE_FIXTURE.result.scan.id
    );
  });

  it("returns a stable expiry error for a terminal job", async () => {
    await expect(
      getScanJobStatus(JOB_ID, "c".repeat(64), () =>
        Promise.resolve([
          {
            job_state: "failed",
            payload: null,
            terminal_error: {
              code: "SCAN_JOB_EXPIRED",
              message: "This queued scan expired. Submit it again.",
              retryable: true,
            },
          },
        ])
      )
    ).resolves.toEqual({
      error: {
        code: "SCAN_JOB_EXPIRED",
        message: "This queued scan expired. Submit it again.",
        retryable: true,
      },
      status: "failed",
    });
  });

  it("claims with bounded lease, attempts, and concurrency", async () => {
    const execute = vi.fn(() =>
      Promise.resolve([
        {
          attempt_count: 2,
          claim_action: "claimed",
          resolved_cache_key: "d".repeat(64),
        },
      ])
    );

    await expect(
      claimScanJob(
        JOB_ID,
        {
          jobTtlSeconds: 3600,
          maxAttempts: 5,
          maxConcurrency: 2,
        },
        execute
      )
    ).resolves.toEqual({
      action: "claimed",
      attempts: 2,
      cacheKey: "d".repeat(64),
    });
    expect(execute).toHaveBeenCalledWith(JOB_ID, JOB_LEASE_SECONDS, 5, 2);
  });

  it("persists only a bounded public error for terminal failure", async () => {
    const execute = vi.fn(() => Promise.resolve([]));
    const error = {
      code: "SOURCE_UNSUPPORTED" as const,
      message: "The source could not be read.",
      retryable: false,
    };

    await recordScanJobFailure(JOB_ID, error, false, 5, execute);

    expect(execute).toHaveBeenCalledWith(JOB_ID, error, false, 5);
  });
});
