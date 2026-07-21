import type { AuditCategory, AuditReport, ScanSource } from "./audit";
import { runAudit } from "./audit";
import { defaultRules } from "./rules/default-rules";

interface ScanOptions {
  category?: AuditCategory;
  filesystemRoot?: string;
  signal?: AbortSignal;
  source?: ScanSource;
}

const BUNDLED_RULESET_VERSION = "2026.07.28";

const scanProject = async (
  rootDir: string,
  options: ScanOptions = {}
): Promise<AuditReport> =>
  runAudit(rootDir, {
    category: options.category,
    filesystemRoot: options.filesystemRoot,
    rules: defaultRules,
    rulesetVersion: BUNDLED_RULESET_VERSION,
    signal: options.signal,
    source: options.source,
  });

export type { ScanOptions };
export { BUNDLED_RULESET_VERSION, scanProject };
