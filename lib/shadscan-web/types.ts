import type { HostedScanResponse } from "../shadscan-api/contracts";
import type { SourceLimitDetail } from "../shadscan-api/source-limits";

const MAX_REPOSITORY_INPUT_LENGTH = 256;
const WEB_SCAN_ERROR_CODES = [
  "GITHUB_SOURCE_NOT_FOUND",
  "INTERNAL_ERROR",
  "INVALID_PROJECT_PATH",
  "INVALID_REPOSITORY",
  "PRIVATE_REPOSITORY_UNSUPPORTED",
  "PROJECT_DISCOVERY_FAILED",
  "RATE_LIMITED",
  "SCAN_BUSY",
  "SCAN_JOB_EXPIRED",
  "SCAN_TIMEOUT",
  "SCAN_WORKER_FAILED",
  "SERVICE_NOT_CONFIGURED",
  "SOURCE_TOO_LARGE",
  "SOURCE_UNSUPPORTED",
  "UPSTREAM_UNAVAILABLE",
] as const;

interface NormalizedGitHubRepository {
  projectPath?: string;
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
  sourceLimit?: SourceLimitDetail;
}

interface WebScanIdleState {
  status: "idle";
}

interface WebScanErrorState {
  error: WebScanError;
  projectPath?: string;
  repositoryInput: string;
  status: "error";
}

interface WebProjectOption {
  label: string;
  path: string;
}

interface WebProjectSelectionState {
  projects: WebProjectOption[];
  repository: string;
  repositoryInput: string;
  repositoryUrl: string;
  status: "project_selection_required";
}

interface WebScanCompleteState {
  projectPath: string;
  repository: string;
  repositoryUrl: string;
  result: HostedScanResponse;
  status: "complete";
}

interface WebScanJobStateBase {
  jobId: string;
  jobToken: string;
  pollAfterMs: number;
  projectPath: string;
  repository: string;
  repositoryInput: string;
  repositoryUrl: string;
}

interface WebScanQueuedState extends WebScanJobStateBase {
  status: "queued";
}

interface WebScanRunningState extends WebScanJobStateBase {
  status: "running";
}

type WebScanJobPollResponse =
  | { pollAfterMs: number; status: "queued" | "running" }
  | { error: WebScanError; status: "failed" }
  | { result: HostedScanResponse; status: "complete" };

type WebScanState =
  | WebProjectSelectionState
  | WebScanCompleteState
  | WebScanErrorState
  | WebScanIdleState
  | WebScanQueuedState
  | WebScanRunningState;

export type {
  NormalizedGitHubRepository,
  WebProjectOption,
  WebProjectSelectionState,
  WebScanCompleteState,
  WebScanError,
  WebScanErrorCode,
  WebScanErrorState,
  WebScanIdleState,
  WebScanJobPollResponse,
  WebScanQueuedState,
  WebScanRunningState,
  WebScanState,
};
export { MAX_REPOSITORY_INPUT_LENGTH, WEB_SCAN_ERROR_CODES };
