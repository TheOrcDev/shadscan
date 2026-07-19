import type { HostedScanResponse } from "../shadscan-api/contracts";

const MAX_REPOSITORY_INPUT_LENGTH = 256;
const WEB_SCAN_ERROR_CODES = [
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
] as const;

interface NormalizedGitHubRepository {
  repository: string;
  repositoryInput: string;
  repositoryKey: string;
  repositoryUrl: string;
}

type WebScanErrorCode = (typeof WEB_SCAN_ERROR_CODES)[number];

interface WebScanError {
  code: WebScanErrorCode;
  message: string;
  retryAfterSeconds?: number;
  retryable: boolean;
}

interface WebScanIdleState {
  status: "idle";
}

interface WebScanErrorState {
  error: WebScanError;
  repositoryInput: string;
  status: "error";
}

interface WebScanCompleteState {
  repository: string;
  repositoryUrl: string;
  result: HostedScanResponse;
  status: "complete";
}

type WebScanState = WebScanCompleteState | WebScanErrorState | WebScanIdleState;

export type {
  NormalizedGitHubRepository,
  WebScanCompleteState,
  WebScanError,
  WebScanErrorCode,
  WebScanErrorState,
  WebScanIdleState,
  WebScanState,
};
export { MAX_REPOSITORY_INPUT_LENGTH, WEB_SCAN_ERROR_CODES };
