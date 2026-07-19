import { z } from "zod";
import { HostedScanResponseSchema } from "../shadscan-api/contracts";
import { MAX_REPOSITORY_INPUT_LENGTH, WEB_SCAN_ERROR_CODES } from "./types";

const RepositoryInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REPOSITORY_INPUT_LENGTH);

const NormalizedGitHubRepositorySchema = z
  .object({
    repository: z.string().min(3).max(140),
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
  })
  .strict();

const WebScanIdleStateSchema = z.object({ status: z.literal("idle") }).strict();

const WebScanErrorStateSchema = z
  .object({
    error: WebScanErrorSchema,
    repositoryInput: z.string().max(MAX_REPOSITORY_INPUT_LENGTH),
    status: z.literal("error"),
  })
  .strict();

const WebScanCompleteStateSchema = z
  .object({
    repository: z.string().min(3).max(140),
    repositoryUrl: z.string().url(),
    result: HostedScanResponseSchema,
    status: z.literal("complete"),
  })
  .strict();

const WebScanStateSchema = z.discriminatedUnion("status", [
  WebScanIdleStateSchema,
  WebScanErrorStateSchema,
  WebScanCompleteStateSchema,
]);

export type {
  NormalizedGitHubRepository,
  WebScanCompleteState,
  WebScanError,
  WebScanErrorCode,
  WebScanErrorState,
  WebScanState,
} from "./types";
export {
  NormalizedGitHubRepositorySchema,
  RepositoryInputSchema,
  WebScanCompleteStateSchema,
  WebScanErrorCodeSchema,
  WebScanErrorSchema,
  WebScanErrorStateSchema,
  WebScanIdleStateSchema,
  WebScanStateSchema,
};
