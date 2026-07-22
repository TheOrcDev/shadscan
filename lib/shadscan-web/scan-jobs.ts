import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "../db/client";
import { WebScanErrorSchema, WebScanJobPollResponseSchema } from "./contracts";
import {
  createScanCacheDescriptor,
  hydrateCachedScanResponse,
  type ScanCacheDescriptor,
  type ScanCacheIdentity,
} from "./scan-cache";
import type { WebScanError, WebScanJobPollResponse } from "./types";

const JOB_POLL_AFTER_MS = 1500;
const JOB_LEASE_SECONDS = 300;
const JOB_STATES = ["completed", "failed", "queued", "running"] as const;
const CLAIM_ACTIONS = ["busy", "claimed", "completed", "terminal"] as const;

interface ScanJobCreation {
  descriptor: ScanCacheDescriptor;
  jobId: string;
  jobToken: string;
  state: (typeof JOB_STATES)[number];
}

interface ScanJobClaim {
  action: (typeof CLAIM_ACTIONS)[number];
  attempts: number;
  cacheKey: string;
}

interface ScanJobLimits {
  jobTtlSeconds: number;
  maxAttempts: number;
  maxConcurrency: number;
}

interface CreateScanJobArguments {
  descriptor: ScanCacheDescriptor;
  jobId: string;
  jobTokenHash: string;
  ttlSeconds: number;
}

type ExecuteCreateScanJob = (
  arguments_: CreateScanJobArguments
) => Promise<unknown>;
type ExecuteGetScanJob = (jobId: string, tokenHash: string) => Promise<unknown>;
type ExecuteClaimScanJob = (
  jobId: string,
  leaseSeconds: number,
  maxAttempts: number,
  maxConcurrency: number
) => Promise<unknown>;
type ExecuteCompleteScanJob = (
  jobId: string,
  cacheKey: string
) => Promise<unknown>;
type ExecuteRecordScanJobFailure = (
  jobId: string,
  error: WebScanError,
  retryable: boolean,
  maxAttempts: number
) => Promise<unknown>;

const CreateScanJobRowsSchema = z
  .array(
    z.object({
      resolved_job_id: z.string().uuid(),
      resolved_state: z.enum(JOB_STATES),
    })
  )
  .length(1);

const GetScanJobRowsSchema = z
  .array(
    z.object({
      job_state: z.enum(JOB_STATES),
      payload: z.unknown().nullable(),
      terminal_error: z.unknown().nullable(),
    })
  )
  .max(1);

const ClaimScanJobRowsSchema = z
  .array(
    z.object({
      attempt_count: z.number().int().nonnegative(),
      claim_action: z.enum(CLAIM_ACTIONS),
      resolved_cache_key: z.string().regex(/^[a-f0-9]{64}$/),
    })
  )
  .max(1);

const executeCreateScanJob: ExecuteCreateScanJob = (arguments_) => {
  const database = getDatabase();
  return database.$client`
    select * from public.create_shadscan_scan_job(
      ${arguments_.jobId}::uuid,
      ${arguments_.jobTokenHash},
      ${arguments_.descriptor.cacheKey},
      ${arguments_.descriptor.repositoryHash},
      ${arguments_.descriptor.commitSha},
      ${arguments_.descriptor.projectPath},
      ${arguments_.descriptor.category},
      ${arguments_.ttlSeconds}
    )
  `;
};

const executeGetScanJob: ExecuteGetScanJob = (jobId, tokenHash) => {
  const database = getDatabase();
  return database.$client`
    select * from public.get_shadscan_scan_job(
      ${jobId}::uuid,
      ${tokenHash}
    )
  `;
};

const executeClaimScanJob: ExecuteClaimScanJob = (
  jobId,
  leaseSeconds,
  maxAttempts,
  maxConcurrency
) => {
  const database = getDatabase();
  return database.$client`
    select * from public.claim_shadscan_scan_job(
      ${jobId}::uuid,
      ${leaseSeconds},
      ${maxAttempts},
      ${maxConcurrency}
    )
  `;
};

const executeCompleteScanJob: ExecuteCompleteScanJob = (jobId, cacheKey) => {
  const database = getDatabase();
  return database.$client`
    select public.complete_shadscan_scan_job(
      ${jobId}::uuid,
      ${cacheKey}
    )
  `;
};

const executeRecordScanJobFailure: ExecuteRecordScanJobFailure = (
  jobId,
  error,
  retryable,
  maxAttempts
) => {
  const database = getDatabase();
  return database.$client`
    select public.record_shadscan_scan_job_failure(
      ${jobId}::uuid,
      ${JSON.stringify(error)}::jsonb,
      ${retryable},
      ${maxAttempts}
    )
  `;
};

const hashScanJobToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

const createScanJob = async (
  identity: ScanCacheIdentity,
  ttlSeconds: number,
  execute: ExecuteCreateScanJob = executeCreateScanJob
): Promise<ScanJobCreation> => {
  const descriptor = createScanCacheDescriptor(identity);
  const proposedJobId = randomUUID();
  const jobToken = randomBytes(32).toString("hex");
  const rows = CreateScanJobRowsSchema.parse(
    await execute({
      descriptor,
      jobId: proposedJobId,
      jobTokenHash: hashScanJobToken(jobToken),
      ttlSeconds,
    })
  );
  const row = rows[0];
  if (!row) {
    throw new Error("The scan job was not created.");
  }

  return {
    descriptor,
    jobId: row.resolved_job_id,
    jobToken,
    state: row.resolved_state,
  };
};

const getScanJobStatus = async (
  jobId: string,
  jobToken: string,
  execute: ExecuteGetScanJob = executeGetScanJob
): Promise<WebScanJobPollResponse | undefined> => {
  const rows = GetScanJobRowsSchema.parse(
    await execute(jobId, hashScanJobToken(jobToken))
  );
  const row = rows[0];
  if (!row) {
    return;
  }

  if (row.job_state === "completed" && row.payload !== null) {
    const result = hydrateCachedScanResponse(row.payload);
    if (result) {
      return WebScanJobPollResponseSchema.parse({
        result,
        status: "complete",
      });
    }
  }

  if (row.job_state === "failed" || row.job_state === "completed") {
    const fallbackError = {
      code: "SCAN_JOB_EXPIRED",
      message: "This queued scan expired. Submit it again.",
      retryable: true,
    } as const;
    return WebScanJobPollResponseSchema.parse({
      error:
        row.terminal_error === null
          ? fallbackError
          : WebScanErrorSchema.parse(row.terminal_error),
      status: "failed",
    });
  }

  return WebScanJobPollResponseSchema.parse({
    pollAfterMs: JOB_POLL_AFTER_MS,
    status: row.job_state,
  });
};

const claimScanJob = async (
  jobId: string,
  limits: ScanJobLimits,
  execute: ExecuteClaimScanJob = executeClaimScanJob
): Promise<ScanJobClaim | undefined> => {
  const rows = ClaimScanJobRowsSchema.parse(
    await execute(
      jobId,
      JOB_LEASE_SECONDS,
      limits.maxAttempts,
      limits.maxConcurrency
    )
  );
  const row = rows[0];
  return row
    ? {
        action: row.claim_action,
        attempts: row.attempt_count,
        cacheKey: row.resolved_cache_key,
      }
    : undefined;
};

const completeScanJob = async (
  jobId: string,
  cacheKey: string,
  execute: ExecuteCompleteScanJob = executeCompleteScanJob
): Promise<void> => {
  await execute(jobId, cacheKey);
};

const recordScanJobFailure = async (
  jobId: string,
  errorInput: WebScanError,
  retryable: boolean,
  maxAttempts: number,
  execute: ExecuteRecordScanJobFailure = executeRecordScanJobFailure
): Promise<void> => {
  const error = WebScanErrorSchema.parse(errorInput);
  await execute(jobId, error, retryable, maxAttempts);
};

export type {
  CreateScanJobArguments,
  ExecuteClaimScanJob,
  ExecuteCompleteScanJob,
  ExecuteCreateScanJob,
  ExecuteGetScanJob,
  ExecuteRecordScanJobFailure,
  ScanJobClaim,
  ScanJobCreation,
  ScanJobLimits,
};
export {
  claimScanJob,
  completeScanJob,
  createScanJob,
  getScanJobStatus,
  hashScanJobToken,
  JOB_LEASE_SECONDS,
  JOB_POLL_AFTER_MS,
  recordScanJobFailure,
};
