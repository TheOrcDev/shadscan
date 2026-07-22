import { z } from "zod";
import { SourceLimitDetailSchema } from "../shadscan-api/source-limits";
import { WEB_SCAN_ERROR_CODES, type WebScanJobPollResponse } from "./types";

const ClientWebScanErrorSchema = z
  .object({
    code: z.enum(WEB_SCAN_ERROR_CODES),
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    retryAfterSeconds: z.number().int().positive().max(86_400).optional(),
    sourceLimit: SourceLimitDetailSchema.optional(),
  })
  .strict();

const ClientHostedScanResponseSchema = z.custom<
  Extract<WebScanJobPollResponse, { status: "complete" }>["result"]
>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "handoff" in value &&
    "report" in value &&
    "scan" in value &&
    "schemaVersion" in value,
  "Expected a hosted scan response."
);

const ClientWebScanJobPollResponseSchema = z.discriminatedUnion("status", [
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
      error: ClientWebScanErrorSchema,
      status: z.literal("failed"),
    })
    .strict(),
  z
    .object({
      result: ClientHostedScanResponseSchema,
      status: z.literal("complete"),
    })
    .strict(),
]);

export { ClientWebScanJobPollResponseSchema };
