import { z } from "zod";
import {
  HostedScanResponseSchema,
  PortableSubdirectorySchema,
} from "../shadscan-api/contracts";
import { SourceLimitDetailSchema } from "../shadscan-api/source-limits";
import { MAX_REPOSITORY_INPUT_LENGTH, WEB_SCAN_ERROR_CODES } from "./types";

const RepositoryInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REPOSITORY_INPUT_LENGTH);

const NormalizedGitHubRepositorySchema = z
  .object({
    repository: z.string().min(3).max(140),
    projectPath: PortableSubdirectorySchema.optional(),
    repositoryInput: RepositoryInputSchema,
    repositoryKey: z.string().min(3).max(140),
    repositoryUrl: z.string().url(),
  })
  .strict();

const WebScanErrorCodeSchema = z.enum(WEB_SCAN_ERROR_CODES);

const WebScanErrorSchema = z
  .object({
    code: WebScanErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().positive().max(86_400).optional(),
    sourceLimit: SourceLimitDetailSchema.optional(),
  })
  .strict();

const WebScanIdleStateSchema = z.object({ status: z.literal("idle") }).strict();

const WebScanErrorStateSchema = z
  .object({
    error: WebScanErrorSchema,
    projectPath: PortableSubdirectorySchema.optional(),
    repositoryInput: z.string().max(MAX_REPOSITORY_INPUT_LENGTH),
    status: z.literal("error"),
  })
  .strict();

const WebScanCompleteStateSchema = z
  .object({
    projectPath: PortableSubdirectorySchema,
    repository: z.string().min(3).max(140),
    repositoryUrl: z.string().url(),
    result: HostedScanResponseSchema,
    status: z.literal("complete"),
  })
  .strict();

const WebScanJobStateBaseSchema = z.object({
  jobId: z.string().uuid(),
  jobToken: z.string().regex(/^[a-f0-9]{64}$/),
  pollAfterMs: z.number().int().min(500).max(30_000),
  projectPath: PortableSubdirectorySchema,
  repository: z.string().min(3).max(140),
  repositoryInput: RepositoryInputSchema,
  repositoryUrl: z.string().url(),
});

const WebScanQueuedStateSchema = WebScanJobStateBaseSchema.extend({
  status: z.literal("queued"),
}).strict();

const WebScanRunningStateSchema = WebScanJobStateBaseSchema.extend({
  status: z.literal("running"),
}).strict();

const WebScanJobPollResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      pollAfterMs: z.number().int().min(500).max(30_000),
      status: z.literal("queued"),
    })
    .strict(),
  z
    .object({
      pollAfterMs: z.number().int().min(500).max(30_000),
      status: z.literal("running"),
    })
    .strict(),
  z
    .object({
      error: WebScanErrorSchema,
      status: z.literal("failed"),
    })
    .strict(),
  z
    .object({
      result: HostedScanResponseSchema,
      status: z.literal("complete"),
    })
    .strict(),
]);

const WebProjectOptionSchema = z
  .object({
    label: z.string().min(1).max(512),
    path: PortableSubdirectorySchema,
  })
  .strict();

const WebProjectSelectionStateSchema = z
  .object({
    projects: z.array(WebProjectOptionSchema).min(2).max(50),
    repository: z.string().min(3).max(140),
    repositoryInput: RepositoryInputSchema,
    repositoryUrl: z.string().url(),
    status: z.literal("project_selection_required"),
  })
  .strict();

const WebScanStateSchema = z.discriminatedUnion("status", [
  WebScanIdleStateSchema,
  WebProjectSelectionStateSchema,
  WebScanErrorStateSchema,
  WebScanCompleteStateSchema,
  WebScanQueuedStateSchema,
  WebScanRunningStateSchema,
]);

export type {
  NormalizedGitHubRepository,
  WebProjectOption,
  WebProjectSelectionState,
  WebScanCompleteState,
  WebScanError,
  WebScanErrorCode,
  WebScanErrorState,
  WebScanJobPollResponse,
  WebScanQueuedState,
  WebScanRunningState,
  WebScanState,
} from "./types";
export {
  NormalizedGitHubRepositorySchema,
  RepositoryInputSchema,
  WebProjectOptionSchema,
  WebProjectSelectionStateSchema,
  WebScanCompleteStateSchema,
  WebScanErrorCodeSchema,
  WebScanErrorSchema,
  WebScanErrorStateSchema,
  WebScanIdleStateSchema,
  WebScanJobPollResponseSchema,
  WebScanQueuedStateSchema,
  WebScanRunningStateSchema,
  WebScanStateSchema,
};
