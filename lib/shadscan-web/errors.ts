import { HostedScanError } from "../shadscan-api/errors";
import {
  type WebScanError,
  type WebScanErrorCode,
  WebScanErrorSchema,
} from "./contracts";

interface WebScanServiceErrorOptions {
  cause?: unknown;
  code: WebScanErrorCode;
  retryAfterSeconds?: number;
  retryable?: boolean;
}

const SOURCE_TOO_LARGE_CODES = new Set([
  "ARCHIVE_COMPRESSED_TOO_LARGE",
  "ARCHIVE_EXPANDED_TOO_LARGE",
  "ARCHIVE_FILE_TOO_LARGE",
  "ARCHIVE_TOO_MANY_ENTRIES",
  "GITHUB_ARCHIVE_TOO_LARGE",
]);

const SOURCE_UNSUPPORTED_CODES = new Set([
  "ARCHIVE_DUPLICATE_PATH",
  "ARCHIVE_PATH_TOO_DEEP",
  "ARCHIVE_PATH_TOO_LONG",
  "INVALID_PACKAGE_JSON",
  "MALFORMED_ARCHIVE",
  "UNSAFE_ARCHIVE_PATH",
  "UNSUPPORTED_ARCHIVE_ENTRY",
]);

const UPSTREAM_CODES = new Set([
  "GITHUB_INVALID_RESPONSE",
  "GITHUB_RATE_LIMITED",
  "GITHUB_TIMEOUT",
  "GITHUB_UNAVAILABLE",
  "GITHUB_UNSAFE_REDIRECT",
  "GITHUB_UPSTREAM_ERROR",
]);

class WebScanServiceError extends Error {
  readonly code: WebScanErrorCode;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, options: WebScanServiceErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "WebScanServiceError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

const getRetryAfterSeconds = (error: HostedScanError): number | undefined => {
  const retryAfter = error.headers.get("retry-after");
  if (!retryAfter) {
    return;
  }

  const seconds = Number.parseInt(retryAfter, 10);
  return Number.isInteger(seconds) && seconds > 0
    ? Math.min(seconds, 86_400)
    : undefined;
};

const mapHostedScanError = (error: HostedScanError): WebScanServiceError => {
  if (error.code === "GITHUB_SOURCE_NOT_FOUND") {
    return new WebScanServiceError(
      "The repository could not be found. Check that it exists and is public.",
      { cause: error, code: "GITHUB_SOURCE_NOT_FOUND" }
    );
  }

  if (error.code === "PRIVATE_REPOSITORY_UNSUPPORTED") {
    return new WebScanServiceError(
      "The web scanner supports public repositories only. Run Shadscan locally for private code.",
      { cause: error, code: "PRIVATE_REPOSITORY_UNSUPPORTED" }
    );
  }

  if (
    error.code === "PROJECT_DISCOVERY_FAILED" ||
    error.code === "PROJECT_ROOT_NOT_FOUND"
  ) {
    return new WebScanServiceError(
      "No supported React project was found at the repository root.",
      { cause: error, code: "PROJECT_DISCOVERY_FAILED" }
    );
  }

  if (SOURCE_TOO_LARGE_CODES.has(error.code)) {
    return new WebScanServiceError(
      "This repository exceeds the web scanner's source limits. Run Shadscan locally instead.",
      { cause: error, code: "SOURCE_TOO_LARGE" }
    );
  }

  if (SOURCE_UNSUPPORTED_CODES.has(error.code)) {
    return new WebScanServiceError(
      "The repository source could not be safely read by the web scanner.",
      { cause: error, code: "SOURCE_UNSUPPORTED" }
    );
  }

  if (UPSTREAM_CODES.has(error.code)) {
    return new WebScanServiceError(
      "GitHub is temporarily unavailable to the scanner. Try again shortly.",
      {
        cause: error,
        code: "UPSTREAM_UNAVAILABLE",
        retryable: error.retryable,
      }
    );
  }

  if (error.code === "RATE_LIMITED") {
    return new WebScanServiceError(
      "Too many scans have been requested. Try again later.",
      {
        cause: error,
        code: "RATE_LIMITED",
        retryable: true,
        retryAfterSeconds: getRetryAfterSeconds(error),
      }
    );
  }

  if (
    error.code === "RATE_LIMIT_NOT_CONFIGURED" ||
    error.code === "RATE_LIMIT_UNAVAILABLE"
  ) {
    return new WebScanServiceError(
      "The web scanner is temporarily unavailable. Try again shortly.",
      {
        cause: error,
        code: "SERVICE_NOT_CONFIGURED",
        retryable: true,
      }
    );
  }

  return new WebScanServiceError(
    "The scan could not be completed. Try again.",
    {
      cause: error,
      code: "INTERNAL_ERROR",
      retryable: true,
    }
  );
};

const asWebScanServiceError = (error: unknown): WebScanServiceError => {
  if (error instanceof WebScanServiceError) {
    return error;
  }

  if (error instanceof HostedScanError) {
    return mapHostedScanError(error);
  }

  return new WebScanServiceError(
    "The scan could not be completed. Try again.",
    {
      cause: error,
      code: "INTERNAL_ERROR",
      retryable: true,
    }
  );
};

const toWebScanError = (error: unknown): WebScanError => {
  const serviceError = asWebScanServiceError(error);
  return WebScanErrorSchema.parse({
    code: serviceError.code,
    message: serviceError.message,
    retryable: serviceError.retryable,
    retryAfterSeconds: serviceError.retryAfterSeconds,
  });
};

export {
  asWebScanServiceError,
  mapHostedScanError,
  toWebScanError,
  WebScanServiceError,
};
