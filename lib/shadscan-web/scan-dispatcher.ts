import { z } from "zod";
import type { HostedScanResponse } from "../shadscan-api/contracts";
import {
  HostedScanCategorySchema,
  PortableSubdirectorySchema,
} from "../shadscan-api/contracts";
import { HostedScanError } from "../shadscan-api/errors";
import type { WebAsyncConfig } from "./async-config";
import type { ScanCacheIdentity } from "./scan-cache";
import {
  createScanJob,
  JOB_POLL_AFTER_MS,
  recordScanJobFailure,
  type ScanJobCreation,
} from "./scan-jobs";
import { sendQueueMessage } from "./vercel-queue";

const ASYNC_SCAN_MESSAGE_SCHEMA_VERSION = 1;
const ASYNC_SCAN_TOPIC = "shadscan-scans";
const QUEUE_FAILURE_ERROR = {
  code: "SERVICE_NOT_CONFIGURED",
  message: "The queued scanner is temporarily unavailable. Try again shortly.",
  retryable: true,
} as const;

const ImmutableGitHubScanInputSchema = z
  .object({
    cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
    category: HostedScanCategorySchema.optional(),
    commitSha: z.string().regex(/^[a-f0-9]{40}$/),
    jobId: z.string().uuid(),
    projectPath: PortableSubdirectorySchema,
    repository: z.string().min(3).max(140),
    schemaVersion: z.literal(ASYNC_SCAN_MESSAGE_SCHEMA_VERSION),
  })
  .strict();

type ImmutableGitHubScanInput = z.infer<typeof ImmutableGitHubScanInputSchema>;

interface ScanDispatchInput {
  asyncConfig: WebAsyncConfig;
  cacheIdentity: ScanCacheIdentity;
  category?: ImmutableGitHubScanInput["category"];
  commitSha: string;
  executeSynchronously: () => Promise<HostedScanResponse>;
  projectPath: string;
  repository: string;
}

type ScanDispatchResult =
  | { kind: "completed"; result: HostedScanResponse }
  | {
      jobId: string;
      jobToken: string;
      kind: "queued";
      pollAfterMs: number;
    };

interface ScanDispatcher {
  dispatch(input: ScanDispatchInput): Promise<ScanDispatchResult>;
}

type QueueSender = typeof sendQueueMessage;
type ScanJobCreator = typeof createScanJob;
type ScanJobFailureRecorder = typeof recordScanJobFailure;

class SynchronousScanDispatcher implements ScanDispatcher {
  async dispatch(input: ScanDispatchInput): Promise<ScanDispatchResult> {
    return {
      kind: "completed",
      result: await input.executeSynchronously(),
    };
  }
}

class VercelQueueScanDispatcher implements ScanDispatcher {
  readonly #createJob: ScanJobCreator;
  readonly #recordFailure: ScanJobFailureRecorder;
  readonly #sendMessage: QueueSender;

  constructor(
    sendMessage: QueueSender = sendQueueMessage,
    createJob: ScanJobCreator = createScanJob,
    recordFailure: ScanJobFailureRecorder = recordScanJobFailure
  ) {
    this.#sendMessage = sendMessage;
    this.#createJob = createJob;
    this.#recordFailure = recordFailure;
  }

  async dispatch(input: ScanDispatchInput): Promise<ScanDispatchResult> {
    const job = await this.#createJob(
      input.cacheIdentity,
      input.asyncConfig.jobTtlSeconds
    );
    const message = createQueueMessage(input, job);

    if (job.state !== "completed") {
      try {
        await this.#sendMessage(ASYNC_SCAN_TOPIC, message, {
          idempotencyKey: job.descriptor.cacheKey,
          retentionSeconds: input.asyncConfig.jobTtlSeconds,
        });
      } catch (error) {
        await this.#recordFailure(
          job.jobId,
          QUEUE_FAILURE_ERROR,
          false,
          input.asyncConfig.maxAttempts
        );
        throw new HostedScanError(
          "The asynchronous scan could not be queued.",
          {
            cause: error,
            code: "ASYNC_QUEUE_UNAVAILABLE",
            retryable: true,
            status: 503,
          }
        );
      }
    }

    return {
      jobId: job.jobId,
      jobToken: job.jobToken,
      kind: "queued",
      pollAfterMs: JOB_POLL_AFTER_MS,
    };
  }
}

const createQueueMessage = (
  input: ScanDispatchInput,
  job: ScanJobCreation
): ImmutableGitHubScanInput =>
  ImmutableGitHubScanInputSchema.parse({
    cacheKey: job.descriptor.cacheKey,
    category: input.category,
    commitSha: input.commitSha,
    jobId: job.jobId,
    projectPath: input.projectPath,
    repository: input.repository,
    schemaVersion: ASYNC_SCAN_MESSAGE_SCHEMA_VERSION,
  });

export type {
  ImmutableGitHubScanInput,
  QueueSender,
  ScanDispatcher,
  ScanDispatchInput,
  ScanDispatchResult,
};
export {
  ASYNC_SCAN_MESSAGE_SCHEMA_VERSION,
  ASYNC_SCAN_TOPIC,
  ImmutableGitHubScanInputSchema,
  SynchronousScanDispatcher,
  VercelQueueScanDispatcher,
};
