import path from "node:path";
import packageJson from "../../package.json";
import {
  type AgentActionable,
  AUDIT_REPORT_SCHEMA_VERSION,
  type AuditReport,
} from "../audit";
import { ProjectDiscoveryError } from "../discovery";
import { stripRoasts } from "../render-human";
import { RULE_CATALOG } from "../rule-catalog";
import { BUNDLED_RULESET_VERSION, scanProject } from "../scan";
import { scanWorkspace } from "../scan-workspace";
import { discoverWorkspace } from "../workspace";
import type {
  ExplainRuleInput,
  ExplainRuleResult,
  ListProjectsInput,
  ListProjectsResult,
  ScanInput,
  ScanResult,
} from "./contracts";

/**
 * Compact responses cap the actionable list; beyond this the response keeps
 * the highest-impact items and says so. Silent truncation reads as "that is
 * everything", which is the one thing an audit must never imply.
 */
const MAX_COMPACT_ACTIONABLES = 20;
const COMPACT_CAP_THRESHOLD = 50;
/** Suggestions offered when an unknown rule id is asked for. */
const NEAREST_RULE_COUNT = 5;

class McpToolError extends Error {}

interface McpToolsOptions {
  roots: string[];
}

const VERSIONS = {
  engineVersion: packageJson.version,
  rulesetVersion: BUNDLED_RULESET_VERSION,
  schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
};

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);

  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
};

/**
 * Roots are fixed when the server starts; tool calls cannot widen them. The
 * error deliberately names the allowed roots and nothing else — no scanner
 * filesystem detail beyond what the client already configured.
 */
const resolveScanPath = (roots: string[], requested?: string): string => {
  const first = roots[0];

  if (first === undefined) {
    throw new McpToolError("The server was started without any roots.");
  }

  if (requested === undefined) {
    return first;
  }

  const resolved = path.resolve(first, requested);
  if (roots.some((root) => isWithin(root, resolved))) {
    return resolved;
  }

  throw new McpToolError(
    `Path is outside the allowed roots (${roots.join(", ")}). Start shadscan mcp with additional root arguments to widen access.`
  );
};

/**
 * Scans are serialized: the parsed-file and render-graph caches are
 * per-project and memory-heavy, and two simultaneous scans of a large
 * repository is an out-of-memory invitation rather than a speedup.
 */
let scanQueue: Promise<unknown> = Promise.resolve();

const enqueue = <Result>(task: () => Promise<Result>): Promise<Result> => {
  const run = scanQueue.then(task, task);
  scanQueue = run.catch(() => undefined);
  return run;
};

/**
 * Mirrors the CLI's routing by calling the same exported functions: only a
 * lone package at the requested root takes the single-package path.
 */
const runScan = async (
  scanPath: string,
  signal: AbortSignal | undefined
): Promise<AuditReport> => {
  const workspace = await discoverWorkspace(scanPath);
  const onlyProject =
    workspace.projects.length === 1 ? workspace.projects[0] : null;
  const scanAsWorkspace =
    workspace.projects.length > 0 && onlyProject?.packageDir !== ".";

  const report = scanAsWorkspace
    ? await scanWorkspace(scanPath, { signal })
    : await scanProject(scanPath, { signal });

  /** Agents quote tool output verbatim; roasts are for humans at a TTY. */
  return stripRoasts(report);
};

const toActionableSummary = (actionable: AgentActionable) => ({
  acceptanceCriteria: actionable.acceptanceCriteria,
  category: actionable.category,
  evidence: actionable.evidence[0]
    ? {
        filePath: actionable.evidence[0].filePath,
        line: actionable.evidence[0].line,
        message: actionable.evidence[0].message,
      }
    : null,
  findingId: actionable.findingId,
  packageDir: actionable.packageDir,
  priority: actionable.priority,
  scoreImpact: actionable.scoreImpact,
  severity: actionable.severity,
  status: actionable.status,
  suggestedFix: actionable.suggestedFix,
  title: actionable.title,
});

const filterActionables = (
  actionables: AgentActionable[],
  input: ScanInput,
  availablePackageDirs: string[]
): AgentActionable[] => {
  let filtered = actionables;

  if (input.category) {
    filtered = filtered.filter(
      (actionable) => actionable.category === input.category
    );
  }

  if (input.severity) {
    filtered = filtered.filter(
      (actionable) => actionable.severity === input.severity
    );
  }

  if (input.packageDir) {
    if (!availablePackageDirs.includes(input.packageDir)) {
      throw new McpToolError(
        availablePackageDirs.length > 0
          ? `Unknown packageDir "${input.packageDir}". Available: ${availablePackageDirs.join(", ")}.`
          : "This scan has no per-package results; omit packageDir."
      );
    }
    filtered = filtered.filter(
      (actionable) => actionable.packageDir === input.packageDir
    );
  }

  return filtered;
};

const scanTool = async (
  options: McpToolsOptions,
  input: ScanInput,
  signal?: AbortSignal
): Promise<ScanResult> => {
  const scanPath = resolveScanPath(options.roots, input.path);
  const report = await enqueue(() => runScan(scanPath, signal));
  const packageDirs =
    report.workspace?.projects.map((project) => project.packageDir) ?? null;
  const filtered = filterActionables(
    report.agentHandoff.actionables,
    input,
    packageDirs ?? []
  );

  const capped =
    !input.full && filtered.length > COMPACT_CAP_THRESHOLD
      ? [...filtered]
          .sort((left, right) => right.scoreImpact - left.scoreImpact)
          .slice(0, MAX_COMPACT_ACTIONABLES)
      : filtered;

  const countsByCategory: Record<string, number> = {};
  for (const actionable of filtered) {
    countsByCategory[actionable.category] =
      (countsByCategory[actionable.category] ?? 0) + 1;
  }

  return {
    ...VERSIONS,
    actionables: capped.map(toActionableSummary),
    actionablesNote:
      capped.length < filtered.length
        ? `${filtered.length} actionables matched; returning the ${capped.length} with the highest score impact. Filter by category, severity, or packageDir to see the rest.`
        : null,
    countsByCategory,
    findings: input.full ? report.findings : null,
    grade: report.grade,
    packageDirs,
    scannedPath: path.relative(options.roots[0] ?? scanPath, scanPath) || ".",
    score: report.score,
    workspace: report.workspace
      ? {
          applicationCount: report.workspace.applicationCount,
          kind: report.workspace.kind,
          skippedCount: report.workspace.skipped.length,
        }
      : null,
  };
};

const listProjectsTool = async (
  options: McpToolsOptions,
  input: ListProjectsInput
): Promise<ListProjectsResult> => {
  const scanPath = resolveScanPath(options.roots, input.path);
  const workspace = await discoverWorkspace(scanPath);

  return {
    engineVersion: VERSIONS.engineVersion,
    kind: workspace.kind,
    projects: workspace.projects.map((project) => ({
      adapter: project.adapter,
      kind: project.kind,
      kindReason: project.kindReason,
      packageDir: project.packageDir,
      packageName: project.packageName,
    })),
    rulesetVersion: VERSIONS.rulesetVersion,
    scannedPath: path.relative(options.roots[0] ?? scanPath, scanPath) || ".",
    skipped: workspace.skipped,
    truncated: workspace.truncated,
  };
};

const explainRuleTool = (input: ExplainRuleInput): ExplainRuleResult => {
  const rule = RULE_CATALOG.find((entry) => entry.id === input.ruleId);

  if (!rule) {
    /** Agents habitually guess kebab-case ids; offer the nearest ones. */
    const nearest = RULE_CATALOG.map((entry) => entry.id)
      .filter(
        (id) =>
          id.startsWith(input.ruleId.split("-")[0] ?? "") ||
          id.includes(input.ruleId)
      )
      .slice(0, NEAREST_RULE_COUNT);

    throw new McpToolError(
      nearest.length > 0
        ? `Unknown rule "${input.ruleId}". Did you mean: ${nearest.join(", ")}?`
        : `Unknown rule "${input.ruleId}". Call scan and use a findingId from the response.`
    );
  }

  return {
    adapters: [...rule.adapters],
    category: rule.category,
    confidence: rule.confidence,
    description: rule.description,
    id: rule.id,
    title: rule.title,
  };
};

/** Discovery failures carry stable public messages; pass those through. */
const toToolErrorMessage = (error: unknown): string => {
  if (error instanceof McpToolError || error instanceof ProjectDiscoveryError) {
    return error.message;
  }

  return "The scan failed unexpectedly. Run the shadscan CLI directly for details.";
};

export type { McpToolsOptions };
export {
  explainRuleTool,
  listProjectsTool,
  McpToolError,
  resolveScanPath,
  scanTool,
  toToolErrorMessage,
};
