import { hostedScanAdmissionController } from "@/lib/shadscan-api/admission";
import { authenticateApiRequest } from "@/lib/shadscan-api/auth";
import type { HostedScanResponse } from "@/lib/shadscan-api/contracts";
import { runWithHostedScanDeadline } from "@/lib/shadscan-api/deadline";
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

interface AcceptedMediaRange {
  index: number;
  quality: number;
  subtype: string;
  type: string;
}

interface FormatPreference {
  format: ResponseFormat;
  index: number;
  quality: number;
  specificity: number;
}

interface SupportedResponseMediaType {
  format: ResponseFormat;
  subtype: string;
  type: string;
}

const BASE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Accept",
  "X-Content-Type-Options": "nosniff",
} as const;
const ACCEPT_QUALITY_PATTERN = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;
const SUPPORTED_RESPONSE_MEDIA_TYPES = [
  { format: "json", subtype: "json", type: "application" },
  { format: "markdown", subtype: "markdown", type: "text" },
] as const satisfies readonly SupportedResponseMediaType[];

const getMediaType = (headerValue: string | null): string =>
  headerValue?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

const parseAcceptedMediaRange = (
  rawRange: string,
  index: number
): AcceptedMediaRange | null => {
  const [rawMediaType, ...rawParameters] = rawRange.toLowerCase().split(";");
  const [type, subtype, ...extraParts] = rawMediaType.trim().split("/");
  if (
    extraParts.length > 0 ||
    !type ||
    !subtype ||
    (type === "*" && subtype !== "*")
  ) {
    return null;
  }

  let quality = 1;
  for (const rawParameter of rawParameters) {
    const [rawName, rawValue, ...extraValues] = rawParameter.split("=");
    if (rawName.trim() !== "q") {
      continue;
    }

    const value = rawValue?.trim() ?? "";
    if (extraValues.length > 0 || !ACCEPT_QUALITY_PATTERN.test(value)) {
      return null;
    }
    quality = Number(value);
  }

  return { index, quality, subtype, type };
};

const getMediaRangeSpecificity = (
  range: AcceptedMediaRange,
  supported: SupportedResponseMediaType
): number | null => {
  if (range.type === "*" && range.subtype === "*") {
    return 0;
  }
  if (range.type === supported.type && range.subtype === "*") {
    return 1;
  }
  if (range.type === supported.type && range.subtype === supported.subtype) {
    return 2;
  }
  return null;
};

const getFormatPreference = (
  supported: SupportedResponseMediaType,
  ranges: AcceptedMediaRange[]
): FormatPreference | null => {
  let preference: FormatPreference | null = null;

  for (const range of ranges) {
    const specificity = getMediaRangeSpecificity(range, supported);
    if (specificity === null) {
      continue;
    }

    if (
      preference === null ||
      specificity > preference.specificity ||
      (specificity === preference.specificity && range.index < preference.index)
    ) {
      preference = {
        format: supported.format,
        index: range.index,
        quality: range.quality,
        specificity,
      };
    }
  }

  return preference;
};

const isPreferredFormat = (
  candidate: FormatPreference,
  selected: FormatPreference | null
): boolean =>
  selected === null ||
  candidate.quality > selected.quality ||
  (candidate.quality === selected.quality &&
    candidate.specificity > selected.specificity) ||
  (candidate.quality === selected.quality &&
    candidate.specificity === selected.specificity &&
    candidate.index < selected.index);

const getResponseFormat = (request: Request): ResponseFormat => {
  const accept = request.headers.get("accept");
  if (!accept?.trim()) {
    return "json";
  }

  const ranges = accept
    .split(",")
    .map(parseAcceptedMediaRange)
    .filter((range): range is AcceptedMediaRange => range !== null);
  let selected: FormatPreference | null = null;
  for (const supported of SUPPORTED_RESPONSE_MEDIA_TYPES) {
    const candidate = getFormatPreference(supported, ranges);
    if (
      candidate &&
      candidate.quality > 0 &&
      isPreferredFormat(candidate, selected)
    ) {
      selected = candidate;
    }
  }

  if (selected) {
    return selected.format;
  }

  throw new HostedScanError(
    `Expected Accept: ${JSON_MEDIA_TYPE} or ${MARKDOWN_MEDIA_TYPE}.`,
    {
      code: "NOT_ACCEPTABLE",
      status: 406,
    }
  );
};

const materializeRequestSource = async (
  request: Request,
  signal: AbortSignal
) => {
  const mediaType = getMediaType(request.headers.get("content-type"));
  if (mediaType === JSON_MEDIA_TYPE) {
    const requestData = await parseGitHubScanRequest(request, signal);
    return materializeGitHubSource(requestData, fetch, signal);
  }

  if (mediaType === SNAPSHOT_MEDIA_TYPE) {
    return materializeSnapshotSource(request, signal);
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
    return await runWithHostedScanDeadline(async (signal) => {
      const authentication = authenticateApiRequest(request);
      const format = getResponseFormat(request);
      return await hostedScanAdmissionController.run(async () => {
        const rateLimit = await enforceRateLimit(authentication.keyId);
        signal.throwIfAborted();
        const source = await materializeRequestSource(request, signal);
        signal.throwIfAborted();
        const result = await runHostedScan(source, signal);
        signal.throwIfAborted();
        return createSuccessResponse(result, format, rateLimit);
      });
    });
  } catch (error) {
    return createErrorResponse(error);
  }
};
