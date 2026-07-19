import { z } from "zod";
import { HostedScanResponseSchema } from "../shadscan-api/contracts";

const MAX_REPOSITORY_INPUT_LENGTH = 256;

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

const WebScanErrorCodeSchema = z.enum([
  "GITHUB_SOURCE_NOT_FOUND",
  "INTERNAL_ERROR",
  "INVALID_REPOSITORY",
  "PRIVATE_REPOSITORY_UNSUPPORTED",
  "PROJECT_DISCOVERY_FAILED",
  "RATE_LIMITED",
  "SERVICE_NOT_CONFIGURED",
  "SOURCE_TOO_LARGE",
  "SOURCE_UNSUPPORTED",
  "UPSTREAM_UNAVAILABLE",
]);

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

type NormalizedGitHubRepository = z.infer<
  typeof NormalizedGitHubRepositorySchema
>;
type WebScanCompleteState = z.infer<typeof WebScanCompleteStateSchema>;
type WebScanError = z.infer<typeof WebScanErrorSchema>;
type WebScanErrorCode = z.infer<typeof WebScanErrorCodeSchema>;
type WebScanErrorState = z.infer<typeof WebScanErrorStateSchema>;
type WebScanState = z.infer<typeof WebScanStateSchema>;

export type {
  NormalizedGitHubRepository,
  WebScanCompleteState,
  WebScanError,
  WebScanErrorCode,
  WebScanErrorState,
  WebScanState,
};
export {
  MAX_REPOSITORY_INPUT_LENGTH,
  NormalizedGitHubRepositorySchema,
  RepositoryInputSchema,
  WebScanCompleteStateSchema,
  WebScanErrorCodeSchema,
  WebScanErrorSchema,
  WebScanErrorStateSchema,
  WebScanIdleStateSchema,
  WebScanStateSchema,
};
