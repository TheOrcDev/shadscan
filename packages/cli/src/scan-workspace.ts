import path from "node:path";
import {
  type AuditFinding,
  type AuditReport,
  createAuditReport,
  type WorkspaceReport,
  type WorkspaceReportProject,
} from "./audit";
import {
  discoverProject,
  type ProjectDiscovery,
  ProjectDiscoveryError,
} from "./discovery";
import { BUNDLED_RULESET_VERSION, type ScanOptions, scanProject } from "./scan";
import { discoverWorkspace, type WorkspaceProject } from "./workspace";

interface ScannedProject {
  project: WorkspaceProject;
  report: AuditReport;
}

type PooledAdapter = ProjectDiscovery["framework"]["adapter"] | "mixed";

/**
 * Evidence arrives project-relative, so two packages would otherwise both
 * report `src/App.tsx`. Re-prefixing with the package directory keeps pooled
 * evidence navigable from the workspace root.
 */
const prefixFindings = (
  findings: AuditFinding[],
  packageDir: string,
  poolsIntoScore: boolean
): AuditFinding[] =>
  findings.map((finding) => ({
    ...finding,
    evidence: finding.evidence.map((item) =>
      item.filePath
        ? {
            ...item,
            filePath:
              packageDir === "."
                ? item.filePath
                : `${packageDir}/${item.filePath}`,
          }
        : item
    ),
    /**
     * Library findings stay visible but must not move the score. The existing
     * category maths already filters on this flag, so excluding them needs no
     * second scoring path.
     */
    impactsScore: poolsIntoScore && finding.impactsScore,
    packageDir,
  }));

/**
 * A pooled report describes several packages, so an adapter that only
 * describes one would be a lie. `mixed` is reported when applications
 * disagree; the per-package adapters stay in `workspace.projects[]`.
 */
const getPooledAdapter = (applications: ScannedProject[]): PooledAdapter => {
  const adapters = new Set(
    applications.map((entry) => entry.report.framework.adapter)
  );
  const [only] = [...adapters];

  return adapters.size === 1 && only ? only : "mixed";
};

const toWorkspaceReportProject = (
  { project, report }: ScannedProject,
  poolsIntoScore: boolean
): WorkspaceReportProject => ({
  adapter: report.framework.adapter,
  grade: report.grade,
  kind: project.kind,
  kindReason: project.kindReason,
  packageDir: project.packageDir,
  packageName: report.packageName,
  poolsIntoScore,
  score: report.score,
});

/**
 * The pooled report needs a project for the fields describing the run as a
 * whole. It carries the workspace root so evidence paths — already
 * workspace-relative by this point — survive normalization unchanged.
 */
const createWorkspaceRootProject = (
  rootDir: string,
  representative: ProjectDiscovery,
  adapter: PooledAdapter
): ProjectDiscovery => ({
  ...representative,
  framework: {
    ...representative.framework,
    adapter: adapter as ProjectDiscovery["framework"]["adapter"],
  },
  packageName: null,
  rootDir,
  selectedProjectPath: ".",
});

/**
 * Audits every application in a workspace and pools their findings into one
 * score. Libraries are scanned and reported but excluded from the pool: a
 * React library scores zero on document-shell rules it should never satisfy.
 */
const scanWorkspace = async (
  rootDir: string,
  options: ScanOptions = {}
): Promise<AuditReport> => {
  const startedAt = performance.now();
  const workspace = await discoverWorkspace(rootDir, options.filesystemRoot);
  const filesystemRoot = options.filesystemRoot ?? workspace.rootDir;
  const scanned: ScannedProject[] = [];

  for (const project of workspace.projects) {
    options.signal?.throwIfAborted();
    const projectDir =
      project.packageDir === "."
        ? workspace.rootDir
        : path.join(workspace.rootDir, project.packageDir);

    scanned.push({
      project,
      report: await scanProject(projectDir, { ...options, filesystemRoot }),
    });
  }

  if (scanned.length === 0) {
    throw new ProjectDiscoveryError(
      "No auditable React package was found in this workspace; run shadscan from a React application package.",
      "UNSUPPORTED_PROJECT"
    );
  }

  const applications = scanned.filter(
    (entry) => entry.project.kind === "application"
  );
  /**
   * With no application present there is nothing for a library to drag down,
   * so a library-only workspace pools its libraries rather than reporting an
   * unassessed score.
   */
  const poolsIntoScore = (entry: ScannedProject): boolean =>
    applications.length === 0 || entry.project.kind === "application";
  const pooledFindings = scanned.flatMap((entry) =>
    prefixFindings(
      entry.report.findings,
      entry.project.packageDir,
      poolsIntoScore(entry)
    )
  );

  /**
   * Prefer an application for the fields describing the run; a library-only
   * workspace still deserves a report rather than an error.
   */
  const representativeDir =
    applications[0]?.project.packageDir ??
    scanned[0]?.project.packageDir ??
    ".";
  const representative = await discoverProject(
    representativeDir === "."
      ? workspace.rootDir
      : path.join(workspace.rootDir, representativeDir),
    { filesystemRoot }
  );

  const workspaceReport: WorkspaceReport = {
    applicationCount: applications.length,
    kind: workspace.kind,
    projects: scanned.map((entry) =>
      toWorkspaceReportProject(entry, poolsIntoScore(entry))
    ),
    skipped: workspace.skipped,
    truncated: workspace.truncated,
  };

  return createAuditReport({
    category: options.category,
    durationMs: performance.now() - startedAt,
    findings: pooledFindings,
    project: createWorkspaceRootProject(
      workspace.rootDir,
      representative,
      getPooledAdapter(applications)
    ),
    rulesetVersion: BUNDLED_RULESET_VERSION,
    source: options.source,
    workspace: workspaceReport,
  });
};

export { scanWorkspace };
