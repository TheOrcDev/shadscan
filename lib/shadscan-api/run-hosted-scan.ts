import { randomUUID } from "node:crypto";
import {
  type HostedScanResponse,
  HostedScanResponseSchema,
  type MaterializedScanSource,
} from "./contracts";
import { runHostedScanWorker } from "./hosted-scan-worker-client";
import { cleanupMaterializationDirectory } from "./materialized-project";
import { HOSTED_SCAN_SCHEMA_VERSION } from "./protocol";

const createScanId = (): string => `scan_${randomUUID().replaceAll("-", "")}`;

const runHostedScan = async (
  source: MaterializedScanSource,
  signal?: AbortSignal
): Promise<HostedScanResponse> => {
  try {
    signal?.throwIfAborted();
    const workerResult = await runHostedScanWorker(source, signal);
    signal?.throwIfAborted();

    return HostedScanResponseSchema.parse({
      handoff: {
        promptMarkdown: workerResult.promptMarkdown,
        promptVersion: workerResult.promptVersion,
      },
      report: workerResult.report,
      scan: {
        engineVersion: workerResult.report.engineVersion,
        id: createScanId(),
        resolvedRevision: source.resolvedRevision,
        rulesetVersion: workerResult.report.rulesetVersion,
        sourceDigest: source.sourceDigest,
        status: "completed",
      },
      schemaVersion: HOSTED_SCAN_SCHEMA_VERSION,
    });
  } finally {
    await cleanupMaterializationDirectory(source.cleanupDirectory);
  }
};

export { runHostedScan };
