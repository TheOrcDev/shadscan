import type { HostedScanErrorBody } from "./contracts";
import { HOSTED_SCAN_SCHEMA_VERSION } from "./protocol";
import type { SourceLimitDetail } from "./source-limits";

type HostedScanErrorStage =
  | "archive_download"
  | "archive_redirect"
  | "repository_metadata"
  | "repository_tree"
  | "resolve_revision"
  | "source_blob";

interface HostedScanErrorDiagnostics {
  kind?: "upstream_request_failed" | "upstream_response_too_large";
  limitBytes?: number;
  observedBytes?: number;
  stage?: HostedScanErrorStage;
  upstreamRequestId?: string;
  upstreamStatus?: number;
}

interface HostedScanErrorOptions {
  cause?: unknown;
  code: string;
  diagnostics?: HostedScanErrorDiagnostics;
  headers?: HeadersInit;
  retryable?: boolean;
  sourceLimit?: SourceLimitDetail;
  status: number;
}

class HostedScanError extends Error {
  readonly code: string;
  readonly diagnostics: HostedScanErrorDiagnostics | undefined;
  readonly headers: Headers;
  readonly retryable: boolean;
  readonly sourceLimit: SourceLimitDetail | undefined;
  readonly status: number;

  constructor(message: string, options: HostedScanErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "HostedScanError";
    this.code = options.code;
    this.diagnostics = options.diagnostics;
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

export type { HostedScanErrorDiagnostics, HostedScanErrorStage };
export { asHostedScanError, HostedScanError, toHostedScanErrorBody };
