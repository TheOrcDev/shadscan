interface WebScanLogEvent {
  actionableCount?: number;
  durationMs: number;
  engineVersion?: string;
  errorCode?: string;
  event: "web_scan";
  outcome: "completed" | "failed";
  repository?: string;
  requestId: string;
  resolvedRevision?: string | null;
  rulesetVersion?: string;
  score?: number | null;
}

const writeWebScanLog = (event: WebScanLogEvent): void => {
  process.stdout.write(
    `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`
  );
};

export type { WebScanLogEvent };
export { writeWebScanLog };
