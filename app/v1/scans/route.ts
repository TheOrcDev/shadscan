import { authenticateApiRequest } from "@/lib/shadscan-api/auth";
import type { HostedScanResponse } from "@/lib/shadscan-api/contracts";
import {
  asHostedScanError,
  HostedScanError,
  toHostedScanErrorBody,
} from "@/lib/shadscan-api/errors";
import {
  materializeGitHubSource,
  parseGitHubScanRequest,
} from "@/lib/shadscan-api/github-source";
import {
  JSON_MEDIA_TYPE,
  MARKDOWN_MEDIA_TYPE,
  SNAPSHOT_MEDIA_TYPE,
} from "@/lib/shadscan-api/protocol";
import {
  enforceRateLimit,
  getRateLimitHeaders,
  type RateLimitDecision,
} from "@/lib/shadscan-api/rate-limit";
import { runHostedScan } from "@/lib/shadscan-api/run-hosted-scan";
import { materializeSnapshotSource } from "@/lib/shadscan-api/snapshot-source";

export const runtime = "nodejs";
export const maxDuration = 30;

type ResponseFormat = "json" | "markdown";

const BASE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Accept",
  "X-Content-Type-Options": "nosniff",
} as const;

const getMediaType = (headerValue: string | null): string =>
  headerValue?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

const getResponseFormat = (request: Request): ResponseFormat => {
  const accept = request.headers.get("accept")?.toLowerCase();
  if (!(accept && accept !== "*/*")) {
    return "json";
  }

  if (accept.includes(MARKDOWN_MEDIA_TYPE)) {
    return "markdown";
  }

  if (accept.includes(JSON_MEDIA_TYPE) || accept.includes("*/*")) {
    return "json";
  }

  throw new HostedScanError(
    `Expected Accept: ${JSON_MEDIA_TYPE} or ${MARKDOWN_MEDIA_TYPE}.`,
    {
      code: "NOT_ACCEPTABLE",
      status: 406,
    }
  );
};

const materializeRequestSource = async (request: Request) => {
  const mediaType = getMediaType(request.headers.get("content-type"));
  if (mediaType === JSON_MEDIA_TYPE) {
    const requestData = await parseGitHubScanRequest(request);
    return materializeGitHubSource(requestData);
  }

  if (mediaType === SNAPSHOT_MEDIA_TYPE) {
    return materializeSnapshotSource(request);
  }

  throw new HostedScanError(
    `Expected Content-Type: ${JSON_MEDIA_TYPE} or ${SNAPSHOT_MEDIA_TYPE}.`,
    {
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    }
  );
};

const createSuccessResponse = (
  result: HostedScanResponse,
  format: ResponseFormat,
  rateLimit: RateLimitDecision
): Response => {
  const headers = new Headers({
    ...BASE_RESPONSE_HEADERS,
    ...getRateLimitHeaders(rateLimit, Date.now()),
  });

  if (format === "markdown") {
    headers.set("Content-Type", `${MARKDOWN_MEDIA_TYPE}; charset=utf-8`);
    return new Response(result.handoff.promptMarkdown, {
      headers,
      status: 200,
    });
  }

  headers.set("Content-Type", `${JSON_MEDIA_TYPE}; charset=utf-8`);
  return new Response(JSON.stringify(result), { headers, status: 200 });
};

const createErrorResponse = (error: unknown): Response => {
  const hostedError = asHostedScanError(error);
  const headers = new Headers({
    ...BASE_RESPONSE_HEADERS,
    "Content-Type": `${JSON_MEDIA_TYPE}; charset=utf-8`,
  });

  for (const [name, value] of hostedError.headers) {
    headers.set(name, value);
  }
  if (hostedError.status === 401) {
    headers.set("WWW-Authenticate", 'Bearer realm="shadscan"');
  }

  return new Response(JSON.stringify(toHostedScanErrorBody(hostedError)), {
    headers,
    status: hostedError.status,
  });
};

export const POST = async (request: Request): Promise<Response> => {
  try {
    const authentication = authenticateApiRequest(request);
    const rateLimit = await enforceRateLimit(authentication.keyId);
    const format = getResponseFormat(request);
    const source = await materializeRequestSource(request);
    const result = await runHostedScan(source);
    return createSuccessResponse(result, format, rateLimit);
  } catch (error) {
    return createErrorResponse(error);
  }
};
