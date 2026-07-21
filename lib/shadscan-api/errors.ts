import type { HostedScanErrorBody } from "./contracts";
import { HOSTED_SCAN_SCHEMA_VERSION } from "./protocol";
import type { SourceLimitDetail } from "./source-limits";

interface HostedScanErrorOptions {
  cause?: unknown;
  code: string;
  headers?: HeadersInit;
  retryable?: boolean;
  sourceLimit?: SourceLimitDetail;
  status: number;
}

class HostedScanError extends Error {
  readonly code: string;
  readonly headers: Headers;
  readonly retryable: boolean;
  readonly sourceLimit: SourceLimitDetail | undefined;
  readonly status: number;

  constructor(message: string, options: HostedScanErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "HostedScanError";
    this.code = options.code;
    this.headers = new Headers(options.headers);
    this.retryable = options.retryable ?? false;
    this.sourceLimit = options.sourceLimit;
    this.status = options.status;
  }
}

const asHostedScanError = (error: unknown): HostedScanError => {
  if (error instanceof HostedScanError) {
    return error;
  }

  return new HostedScanError("The scan could not be completed.", {
    cause: error,
    code: "INTERNAL_ERROR",
    retryable: true,
    status: 500,
  });
};

const toHostedScanErrorBody = (
  error: HostedScanError
): HostedScanErrorBody => ({
  error: {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  },
  schemaVersion: HOSTED_SCAN_SCHEMA_VERSION,
});

export { asHostedScanError, HostedScanError, toHostedScanErrorBody };
