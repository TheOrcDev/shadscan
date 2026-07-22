import type { ArchiveLimits } from "../shadscan-api/archive";
import { planSparseGitHubSource } from "../shadscan-api/github-sparse-source";
import {
  type GitHubTreeEntry,
  getRetainedGitHubTreeEntries,
} from "../shadscan-api/github-tree";
import type { WebAsyncConfig } from "./async-config";

interface WebScanWorkload {
  kind: "async" | "sync";
  relevantBytes: number;
  relevantFiles: number;
}

const classifyWebScanWorkload = (
  treeEntries: GitHubTreeEntry[],
  projectPath: string,
  limits: ArchiveLimits,
  asyncConfig: WebAsyncConfig
): WebScanWorkload => {
  const retainedEntries = getRetainedGitHubTreeEntries(
    treeEntries,
    projectPath
  );
  const plan = planSparseGitHubSource(retainedEntries, limits);
  const relevantFiles = plan.contentEntries.length;
  const exceedsSyncThreshold =
    relevantFiles > asyncConfig.syncRelevantFiles ||
    plan.contentBytes > asyncConfig.syncRelevantBytes;

  return {
    kind: asyncConfig.enabled && exceedsSyncThreshold ? "async" : "sync",
    relevantBytes: plan.contentBytes,
    relevantFiles,
  };
};

export type { WebScanWorkload };
export { classifyWebScanWorkload };
