import { randomUUID } from "node:crypto";
import {
  AGENT_PROMPT_VERSION,
  ProjectDiscoveryError,
  renderAgentPrompt,
  scanProject,
} from "@shadscan/cli";
import {
  type HostedScanResponse,
  HostedScanResponseSchema,
  type MaterializedScanSource,
} from "./contracts";
import { HostedScanError } from "./errors";
import { cleanupMaterializationDirectory } from "./materialized-project";
import { HOSTED_SCAN_SCHEMA_VERSION } from "./protocol";

const createScanId = (): string => `scan_${randomUUID().replaceAll("-", "")}`;

const runHostedScan = async (
  source: MaterializedScanSource
): Promise<HostedScanResponse> => {
  try {
    const report = await scanProject(source.projectRoot, {
      category: source.category,
      source: {
        digest: source.sourceDigest,
        kind: source.sourceKind,
        revision: source.resolvedRevision,
      },
    });
    const promptMarkdown = renderAgentPrompt(report);

    return HostedScanResponseSchema.parse({
      handoff: {
        promptMarkdown,
        promptVersion: AGENT_PROMPT_VERSION,
      },
      report,
      scan: {
        engineVersion: report.engineVersion,
        id: createScanId(),
        resolvedRevision: source.resolvedRevision,
        rulesetVersion: report.rulesetVersion,
        sourceDigest: source.sourceDigest,
        status: "completed",
      },
      schemaVersion: HOSTED_SCAN_SCHEMA_VERSION,
    });
  } catch (error) {
    if (error instanceof ProjectDiscoveryError) {
      throw new HostedScanError(
        "The selected source is not a supported React project.",
        {
          cause: error,
          code: "PROJECT_DISCOVERY_FAILED",
          status: 422,
        }
      );
    }

    throw error;
  } finally {
    await cleanupMaterializationDirectory(source.cleanupDirectory);
  }
};

export { runHostedScan };
