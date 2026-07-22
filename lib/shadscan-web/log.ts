import type { HostedScanErrorDiagnostics } from "../shadscan-api/errors";

interface WebScanLogEvent {
  actionableCount?: number;
  durationMs: number;
  engineVersion?: string;
  errorCode?: string;
  event: "web_scan";
  failureKind?: HostedScanErrorDiagnostics["kind"];
  failureStage?: HostedScanErrorDiagnostics["stage"];
  internalErrorCode?: string;
  internalStatus?: number;
  limitBytes?: number;
  observedBytes?: number;
  outcome: "completed" | "failed" | "queued" | "selection_required";
  repository?: string;
  requestId: string;
  resolvedRevision?: string | null;
  rulesetVersion?: string;
  score?: number | null;
  upstreamRequestId?: string;
  upstreamStatus?: number;
}

const writeWebScanLog = (event: WebScanLogEvent): void => {
  process.stdout.write(
    `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`
  );
};

export type { WebScanLogEvent };
export { writeWebScanLog };
