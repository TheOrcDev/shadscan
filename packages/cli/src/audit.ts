import path from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import packageJson from "../package.json";
import { compareCodeUnits } from "./deterministic-order";
import {
  type Confidence,
  discoverProject,
  type FrameworkAdapter,
  type ProjectDiscovery,
} from "./discovery";

const AUDIT_CATEGORIES = [
  "foundation",
  "interaction",
  "states",
  "accessibility",
  "forms",
  "production-polish",
] as const;

const AUDIT_REPORT_SCHEMA_VERSION = 9 as const;
const ENGINE_VERSION = packageJson.version;
const CUSTOM_RULESET_VERSION = "custom";
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;

const CATEGORY_DETAILS = {
  accessibility: {
    title: "Accessibility",
    weight: 20,
  },
  forms: {
    title: "Forms and Data Entry",
    weight: 10,
  },
  foundation: {
    title: "Foundation",
    weight: 20,
  },
  interaction: {
    title: "Interaction",
    weight: 20,
  },
  "production-polish": {
    title: "Production Polish",
    weight: 10,
  },
  states: {
    title: "States",
    weight: 20,
  },
} as const satisfies Record<AuditCategory, { title: string; weight: number }>;

const AuditCategorySchema = z.enum(AUDIT_CATEGORIES);
const ActionableDispositionSchema = z.enum(["decide", "fix", "verify"]);
const ActionablePrioritySchema = z.enum(["P0", "P1", "P2"]);
const ConfidenceSchema = z.enum(["high", "medium", "low"]);
const RuleStatusSchema = z.enum(["advisory", "fail", "not-applicable", "pass"]);
const ScanSourceKindSchema = z.enum(["git", "snapshot", "working-tree"]);
const SeveritySchema = z.enum(["error", "info", "warning"]);
type ActionablePriority = z.infer<typeof ActionablePrioritySchema>;
type ActionableDisposition = z.infer<typeof ActionableDispositionSchema>;
type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
type AuditRuleAdapter = "core" | FrameworkAdapter;
type AuditRuleStatus = z.infer<typeof RuleStatusSchema>;
type AuditSeverity = z.infer<typeof SeveritySchema>;
type AuditGrade = "A" | "B" | "C" | "D" | "F";
type ScanSourceKind = z.infer<typeof ScanSourceKindSchema>;

interface ScanSource {
  digest: string | null;
  kind: ScanSourceKind;
  revision: string | null;
}

interface ScanScope {
  categories: AuditCategory[];
}

interface AuditEvidence {
  filePath?: string;
  line?: number;
  message: string;
}

interface AuditContext {
  filesystemRoot: string;
  project: ProjectDiscovery;
}

interface AuditRuleResult {
  confidence?: Confidence;
  evidence?: AuditEvidence[];
  remediation?: string;
  roast?: string;
  status: AuditRuleStatus;
}

interface AuditRule {
  adapters: AuditRuleAdapter[];
  category: AuditCategory;
  confidence: Confidence;
  description: string;
  id: string;
  maxScore: number;
  run: (context: AuditContext) => Promise<AuditRuleResult> | AuditRuleResult;
  severity: AuditSeverity;
  title: string;
}

interface WorkspaceReportProject {
  adapter: string;
  grade: AuditGrade | null;
  kind: "application" | "library";
  kindReason: string;
  packageDir: string;
  packageName: string | null;
  /** Applications feed the pooled score; libraries are reported but excluded. */
  poolsIntoScore: boolean;
  score: number | null;
}

interface WorkspaceReport {
  applicationCount: number;
  kind: string;
  projects: WorkspaceReportProject[];
  skipped: { packageDir: string; reason: string }[];
  truncated: number;
}

interface AuditFinding {
  category: AuditCategory;
  confidence: Confidence;
  description: string;
  evidence: AuditEvidence[];
  id: string;
  impactsScore: boolean;
  maxScore: number;
  /** Workspace-relative package the finding came from; null outside a workspace scan. */
  packageDir: string | null;
  remediation: string | null;
  roast: string | null;
  score: number;
  severity: AuditSeverity;
  status: AuditRuleStatus;
  title: string;
}

interface AuditCategoryScore {
  applicable: boolean;
  id: AuditCategory;
  maxScore: number;
  percentage: number | null;
  score: number;
  title: string;
  weight: number;
}

interface AgentActionable {
  acceptanceCriteria: string[];
  category: AuditCategory;
  confidence: Confidence;
  disposition: ActionableDisposition;
  evidence: AuditEvidence[];
  findingId: string;
  priority: ActionablePriority;
  scoreImpact: number;
  severity: AuditSeverity;
  status: Extract<AuditRuleStatus, "advisory" | "fail">;
  suggestedFix: string | null;
  summary: string;
  title: string;
}

interface AgentWorkItem {
  acceptanceCriteria: string[];
  categories: AuditCategory[];
  disposition: ActionableDisposition;
  evidence: AuditEvidence[];
  findingIds: string[];
  id: string;
  priority: ActionablePriority;
  rawScoreImpact: number;
  suggestedFixes: string[];
  summary: string;
  title: string;
}

interface AgentVerification {
  projectGates: string[];
  shadscanCommand: string;
}

interface AgentHandoff {
  actionables: AgentActionable[];
  context: string[];
  goal: string;
  suggestedSkills: string[];
  verification: AgentVerification;
  workItems: AgentWorkItem[];
}

interface AuditReport {
  agentHandoff: AgentHandoff;
  categories: AuditCategoryScore[];
  coverage: {
    source: ProjectDiscovery["sourceCoverage"];
  };
  durationMs: number;
  engineVersion: string;
  findings: AuditFinding[];
  framework: {
    adapter: ProjectDiscovery["framework"]["adapter"] | "mixed";
    evidence: string[];
  };
  grade: AuditGrade | null;
  maxScore: 100;
  packageManager: ProjectDiscovery["packageManager"];
  packageName: string | null;
  rulesetVersion: string;
  schemaVersion: typeof AUDIT_REPORT_SCHEMA_VERSION;
  scope: ScanScope;
  score: number | null;
  shadcn: Pick<
    ProjectDiscovery["shadcn"],
    "confidence" | "configPath" | "style"
  >;
  source: ScanSource;
  versions: ProjectDiscovery["versions"];
  warnings: string[];
  /** Populated only by a workspace scan; null for a single-package scan. */
  workspace: WorkspaceReport | null;
}

interface RunAuditOptions {
  category?: AuditCategory;
  filesystemRoot?: string;
  rules: AuditRule[];
  rulesetVersion?: string;
  signal?: AbortSignal;
  source?: ScanSource;
}

const isPortableProjectPath = (filePath: string): boolean => {
  if (filePath === ".") {
    return true;
  }

  if (
    filePath.startsWith("/") ||
    filePath.startsWith("\\") ||
    filePath.includes("\\") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(filePath)
  ) {
    return false;
  }

  return filePath.split("/").every((segment) => segment !== "..");
};

const ProjectPathSchema = z
  .string()
  .min(1)
  .refine(isPortableProjectPath, "Expected a project-relative POSIX path.");

const AuditEvidenceSchema = z.object({
  filePath: ProjectPathSchema.optional(),
  line: z.number().int().positive().optional(),
  message: z.string(),
});

const AuditFindingSchema = z.object({
  category: AuditCategorySchema,
  confidence: ConfidenceSchema,
  description: z.string(),
  evidence: z.array(AuditEvidenceSchema),
  id: z.string(),
  impactsScore: z.boolean(),
  maxScore: z.number(),
  packageDir: z.string().nullable(),
  remediation: z.string().nullable(),
  roast: z.string().nullable(),
  score: z.number(),
  severity: SeveritySchema,
  status: RuleStatusSchema,
  title: z.string(),
});

const AgentActionableSchema = z.object({
  acceptanceCriteria: z.array(z.string()),
  category: AuditCategorySchema,
  confidence: ConfidenceSchema,
  disposition: ActionableDispositionSchema,
  evidence: z.array(AuditEvidenceSchema),
  findingId: z.string(),
  priority: ActionablePrioritySchema,
  scoreImpact: z.number(),
  severity: SeveritySchema,
  status: z.enum(["advisory", "fail"]),
  suggestedFix: z.string().nullable(),
  summary: z.string(),
  title: z.string(),
});

const AgentWorkItemSchema = z.object({
  acceptanceCriteria: z.array(z.string()),
  categories: z.array(AuditCategorySchema).min(1),
  disposition: ActionableDispositionSchema,
  evidence: z.array(AuditEvidenceSchema),
  findingIds: z.array(z.string()).min(1),
  id: z.string(),
  priority: ActionablePrioritySchema,
  rawScoreImpact: z.number(),
  suggestedFixes: z.array(z.string()),
  summary: z.string(),
  title: z.string(),
});

const AgentVerificationSchema = z.object({
  projectGates: z.array(z.string()),
  shadscanCommand: z.string(),
});

const AgentHandoffSchema = z.object({
  actionables: z.array(AgentActionableSchema),
  context: z.array(z.string()),
  goal: z.string(),
  suggestedSkills: z.array(z.string()),
  verification: AgentVerificationSchema,
  workItems: z.array(AgentWorkItemSchema),
});

const WorkspaceReportSchema = z.object({
  applicationCount: z.number(),
  kind: z.string(),
  projects: z.array(
    z.object({
      adapter: z.string(),
      grade: z.enum(["A", "B", "C", "D", "F"]).nullable(),
      kind: z.enum(["application", "library"]),
      kindReason: z.string(),
      packageDir: z.string(),
      packageName: z.string().nullable(),
      poolsIntoScore: z.boolean(),
      score: z.number().nullable(),
    })
  ),
  skipped: z.array(z.object({ packageDir: z.string(), reason: z.string() })),
  truncated: z.number(),
});

const AuditReportSchema = z.object({
  agentHandoff: AgentHandoffSchema,
  categories: z.array(
    z.object({
      applicable: z.boolean(),
      id: AuditCategorySchema,
      maxScore: z.number(),
      percentage: z.number().nullable(),
      score: z.number(),
      title: z.string(),
      weight: z.number(),
    })
  ),
  coverage: z.object({
    source: z.enum(["complete", "partial"]),
  }),
  durationMs: z.number(),
  engineVersion: z.string().min(1),
  findings: z.array(AuditFindingSchema),
  framework: z.object({
    adapter: z.enum([
      "astro-react",
      "generic-react",
      "laravel-inertia-react",
      /** Workspace scans only: the pooled applications use different adapters. */
      "mixed",
      "next-app-router",
      "next-hybrid-router",
      "next-pages-router",
      "react-router-framework",
      "tanstack-start",
      "vite-react",
    ]),
    evidence: z.array(z.string()),
  }),
  grade: z.enum(["A", "B", "C", "D", "F"]).nullable(),
  maxScore: z.literal(100),
  packageManager: z.enum(["bun", "npm", "pnpm", "unknown", "yarn"]),
  packageName: z.string().nullable(),
  rulesetVersion: z.string().min(1),
  schemaVersion: z.literal(AUDIT_REPORT_SCHEMA_VERSION),
  score: z.number().min(0).max(100).nullable(),
  scope: z.object({
    categories: z.array(AuditCategorySchema).min(1),
  }),
  shadcn: z.object({
    confidence: ConfidenceSchema,
    configPath: ProjectPathSchema.nullable(),
    style: z.string().nullable(),
  }),
  source: z.object({
    digest: z.string().min(1).nullable(),
    kind: ScanSourceKindSchema,
    revision: z.string().min(1).nullable(),
  }),
  versions: z.object({
    astro: z.string().nullable(),
    inertia: z.string().nullable(),
    laravel: z.string().nullable(),
    next: z.string().nullable(),
    react: z.string().nullable(),
    reactRouter: z.string().nullable(),
    tanstackStart: z.string().nullable(),
    vite: z.string().nullable(),
  }),
  warnings: z.array(z.string()),
  workspace: WorkspaceReportSchema.nullable(),
});

const getGrade = (score: number): AuditGrade => {
  if (score >= 90) {
    return "A";
  }

  if (score >= 80) {
    return "B";
  }

  if (score >= 70) {
    return "C";
  }

  if (score >= 60) {
    return "D";
  }

  return "F";
};

const getProjectRelativePath = (
  rootDir: string,
  filePath: string
): string | undefined => {
  const absoluteRoot = path.resolve(rootDir);
  const absoluteFile = path.resolve(absoluteRoot, filePath);
  const relativePath = path.relative(absoluteRoot, absoluteFile);
  const isOutsideRoot =
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath);

  if (isOutsideRoot) {
    return;
  }

  if (relativePath === "") {
    return ".";
  }

  return relativePath.split(path.sep).join("/");
};

const normalizeEvidencePaths = (
  evidence: AuditEvidence[],
  rootDir: string
): AuditEvidence[] =>
  evidence
    .map((item) => {
      if (!item.filePath) {
        return item;
      }

      const filePath = getProjectRelativePath(rootDir, item.filePath);

      if (!filePath) {
        return {
          line: item.line,
          message: item.message,
        };
      }

      return { ...item, filePath };
    })
    .sort(
      (left, right) =>
        compareCodeUnits(left.filePath ?? "", right.filePath ?? "") ||
        (left.line ?? 0) - (right.line ?? 0) ||
        compareCodeUnits(left.message, right.message)
    );

const normalizeFindingPaths = (
  findings: AuditFinding[],
  rootDir: string
): AuditFinding[] =>
  findings.map((finding) => ({
    ...finding,
    evidence: normalizeEvidencePaths(finding.evidence, rootDir),
  }));

const shouldRunRule = ({
  category,
  project,
  rule,
}: {
  category?: AuditCategory;
  project: ProjectDiscovery;
  rule: AuditRule;
}): boolean => {
  if (category && rule.category !== category) {
    return false;
  }

  if (project.framework.adapter === "next-hybrid-router") {
    return (
      rule.adapters.includes("core") ||
      rule.adapters.includes("next-app-router") ||
      rule.adapters.includes("next-hybrid-router") ||
      rule.adapters.includes("next-pages-router")
    );
  }

  return (
    rule.adapters.includes("core") ||
    rule.adapters.includes(project.framework.adapter)
  );
};

const normalizeFinding = (
  rule: AuditRule,
  result: AuditRuleResult
): AuditFinding => {
  const confidence = result.confidence ?? rule.confidence;
  const advisoryFail = result.status === "fail" && confidence === "low";
  const status: AuditRuleStatus = advisoryFail ? "advisory" : result.status;
  const impactsScore =
    rule.maxScore > 0 && status !== "advisory" && status !== "not-applicable";
  const maxScore = status === "not-applicable" ? 0 : rule.maxScore;
  const score = (() => {
    if (status === "pass" || status === "advisory") {
      return maxScore;
    }

    return 0;
  })();

  return {
    category: rule.category,
    confidence,
    description: rule.description,
    evidence: result.evidence ?? [],
    id: rule.id,
    impactsScore,
    maxScore,
    packageDir: null,
    remediation: result.remediation ?? null,
    roast: result.roast ?? null,
    score,
    severity: rule.severity,
    status,
    title: rule.title,
  };
};

const getCategoryScores = (findings: AuditFinding[]): AuditCategoryScore[] =>
  AUDIT_CATEGORIES.map((category) => {
    const categoryFindings = findings.filter(
      (finding) => finding.category === category
    );
    const scoredFindings = categoryFindings.filter(
      (finding) => finding.impactsScore
    );
    const rawMaxScore = scoredFindings.reduce(
      (total, finding) => total + finding.maxScore,
      0
    );
    const rawScore = scoredFindings.reduce(
      (total, finding) => total + finding.score,
      0
    );
    const applicable = rawMaxScore > 0;
    const ratio = applicable ? rawScore / rawMaxScore : null;
    const weight = CATEGORY_DETAILS[category].weight;

    return {
      applicable,
      id: category,
      maxScore: applicable ? weight : 0,
      percentage: ratio === null ? null : Math.round(ratio * 100),
      score: ratio === null ? 0 : ratio * weight,
      title: CATEGORY_DETAILS[category].title,
      weight,
    };
  });

const getTotalScore = (categories: AuditCategoryScore[]): number | null => {
  const applicableCategories = categories.filter(
    (category) => category.applicable
  );
  const activeWeight = applicableCategories.reduce(
    (total, category) => total + category.weight,
    0
  );

  if (activeWeight === 0) {
    return null;
  }

  const weightedScore = applicableCategories.reduce(
    (total, category) => total + category.score,
    0
  );

  return Math.round((weightedScore / activeWeight) * 100);
};

const PRIORITY_ORDER: Record<ActionablePriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};
const DISPOSITION_ORDER: Record<ActionableDisposition, number> = {
  fix: 0,
  decide: 1,
  verify: 2,
};
const PROJECT_GATE_SCRIPT_NAMES = [
  "check",
  "lint",
  "typecheck",
  "test",
  "build",
] as const;
const MAX_NAMESPACED_TEST_GATES = 20;
const SAFE_SCRIPT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
const isNamespacedTestGate = (scriptName: string): boolean =>
  SAFE_SCRIPT_NAME_PATTERN.test(scriptName) &&
  (scriptName.startsWith("test:") || scriptName.endsWith(":test"));
const PACKAGE_EXECUTORS = {
  bun: (packageSpecifier: string) => `bunx ${packageSpecifier}`,
  npm: (packageSpecifier: string) => `npx --yes ${packageSpecifier}`,
  pnpm: (packageSpecifier: string) => `pnpm dlx ${packageSpecifier}`,
  unknown: (packageSpecifier: string) => `npx --yes ${packageSpecifier}`,
  yarn: (packageSpecifier: string) =>
    `yarn dlx --package ${packageSpecifier} shadscan`,
} as const satisfies Record<
  ProjectDiscovery["packageManager"],
  (packageSpecifier: string) => string
>;
const SCRIPT_RUNNERS = {
  bun: "bun run",
  npm: "npm run",
  pnpm: "pnpm",
  unknown: "npm run",
  yarn: "yarn",
} as const satisfies Record<ProjectDiscovery["packageManager"], string>;
const SAFE_SHELL_ARGUMENT_PATTERN = /^[A-Za-z0-9_./:@+-]+$/;
const quoteShellArgument = (value: string): string =>
  SAFE_SHELL_ARGUMENT_PATTERN.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
const getSelectedProjectArgument = (
  project: ProjectDiscovery
): string | null =>
  project.selectedProjectPath === "."
    ? null
    : quoteShellArgument(`./${project.selectedProjectPath}`);
const getProjectScriptRunner = (project: ProjectDiscovery): string => {
  const projectArgument = getSelectedProjectArgument(project);

  if (!projectArgument) {
    return SCRIPT_RUNNERS[project.packageManager];
  }

  switch (project.packageManager) {
    case "bun":
      return `bun --cwd ${projectArgument} run`;
    case "pnpm":
      return `pnpm --dir ${projectArgument}`;
    case "yarn":
      return `yarn --cwd ${projectArgument}`;
    default:
      return `npm --prefix ${projectArgument} run`;
  }
};
const PRODUCT_DECISION_DETAILS: Record<
  string,
  { summary: string; title: string }
> = {
  "command-menu-hotkey-present": {
    summary:
      "Decide whether the app has enough navigation or actions to justify a command menu and shortcut.",
    title: "Decide the command-menu interaction",
  },
  "command-menu-present": {
    summary:
      "Decide whether the app has enough navigation or actions to justify a command menu and shortcut.",
    title: "Decide the command-menu interaction",
  },
  "mobile-nav-present": {
    summary:
      "Choose a mobile navigation pattern that fits the app, or document why visible page flow is sufficient.",
    title: "Decide the mobile navigation pattern",
  },
  "public-app-seo-files-present": {
    summary:
      "Choose whether the app should be indexed, then add framework-native SEO files or document an explicit noindex policy.",
    title: "Decide the app indexing policy",
  },
  "toast-provider-mounted": {
    summary:
      "Choose how transient success and failure feedback should work before adding notification infrastructure.",
    title: "Decide the transient-feedback pattern",
  },
  "toast-provider-present": {
    summary:
      "Choose how transient success and failure feedback should work before adding notification infrastructure.",
    title: "Decide the transient-feedback pattern",
  },
};
const WORK_ITEM_GROUPS = [
  {
    findingIds: ["forms-have-labels", "invalid-fields-associated-with-errors"],
    id: "form-field-accessibility",
    summary:
      "Make each affected field discoverable by name and connect invalid state to its rendered error message.",
    title: "Associate form fields with labels and errors",
  },
  {
    findingIds: ["command-menu-present", "command-menu-hotkey-present"],
    id: "command-menu",
    summary:
      "Decide whether the product warrants a command menu; if it does, ship the menu and its keyboard entry point together.",
    title: "Decide the command-menu experience",
  },
  {
    findingIds: [
      "error-boundary-present",
      "error-state-retry-present",
      "route-loading-boundary-present",
      "suspense-fallback-useful",
    ],
    id: "route-resilience",
    summary:
      "Keep route failures recoverable and suspended content visibly represented instead of blanking the application shell.",
    title: "Provide route recovery and useful loading UI",
  },
  {
    findingIds: [
      "toast-provider-present",
      "toast-provider-mounted",
      "status-messages-announced",
    ],
    id: "transient-feedback",
    summary:
      "Choose a feedback channel based on real user actions, and avoid mounting an unused provider solely for the audit score.",
    title: "Decide how transient feedback should work",
  },
  {
    findingIds: [
      "color-contrast-passes",
      "pointer-target-size-passes",
      "mobile-overflow-absent",
    ],
    id: "rendered-ui-verification",
    summary:
      "Verify computed accessibility and responsive behavior in a browser at representative themes, states, and viewport widths.",
    title: "Verify rendered accessibility and responsive behavior",
  },
] as const;

const getActionablePriority = (finding: AuditFinding): ActionablePriority => {
  if (finding.severity === "error" && finding.status === "fail") {
    return "P0";
  }

  if (finding.status === "fail" && finding.confidence === "high") {
    return "P1";
  }

  return "P2";
};

const getActionableDisposition = (
  finding: AuditFinding
): ActionableDisposition => {
  if (PRODUCT_DECISION_DETAILS[finding.id]) {
    return "decide";
  }

  return finding.status === "advisory" ? "verify" : "fix";
};

const getActionableSummary = (
  finding: AuditFinding,
  disposition: ActionableDisposition
): string => {
  const decisionDetails = PRODUCT_DECISION_DETAILS[finding.id];

  if (decisionDetails) {
    return decisionDetails.summary;
  }

  if (disposition === "verify") {
    return `Verify ${finding.title}; shadscan has low-confidence evidence and did not reduce the score.`;
  }

  return `Fix ${finding.title}; shadscan marked this as a ${finding.confidence}-confidence missing UI fundamental.`;
};

const getActionableTitle = (
  finding: AuditFinding,
  disposition: ActionableDisposition
): string => {
  const decisionDetails = PRODUCT_DECISION_DETAILS[finding.id];

  if (decisionDetails) {
    return decisionDetails.title;
  }

  return `${disposition === "verify" ? "Verify" : "Fix"} ${finding.title}`;
};

const getProjectGateCriterion = (
  projectGates: string[],
  prefix: string
): string => {
  if (projectGates.length === 0) {
    return `${prefix} inspect repository-owned package scripts, then run every authorized check, lint, typecheck, test, and build gate relevant to the change; report any gate that was not safe or authorized to run.`;
  }

  const commands = projectGates.map((command) => `\`${command}\``).join(", ");
  return `${prefix} inspect the repository-owned script definitions, then run every authorized discovered project gate: ${commands}; report any gate that was not safe or authorized to run.`;
};

const getActionableAcceptanceCriteria = ({
  disposition,
  finding,
  projectGates,
}: {
  disposition: ActionableDisposition;
  finding: AuditFinding;
  projectGates: string[];
}): string[] => {
  if (disposition === "verify") {
    return [
      "Record the finding as confirmed, verified-no-change, or unable-to-verify, with rendered or composed evidence.",
      "Do not edit solely to force a score-neutral static advisory to report pass; it may remain advisory after successful verification.",
      getProjectGateCriterion(projectGates, "If code changes,"),
    ];
  }

  if (disposition === "decide") {
    return [
      "Record an explicit implement-or-waive product decision based on the app's current workflows.",
      `If implemented, the shadscan finding \`${finding.id}\` reports pass; if waived, keep it visible and report the rationale.`,
      "Do not add unused infrastructure solely to increase the audit score.",
      getProjectGateCriterion(projectGates, "If code changes,"),
    ];
  }

  const criteria = [
    `The shadscan finding \`${finding.id}\` reports pass when rerun with the same ruleset and category scope.`,
  ];

  if (finding.remediation) {
    criteria.push(
      `The implementation matches this remediation: ${finding.remediation}`
    );
  }

  criteria.push(getProjectGateCriterion(projectGates, "After the change,"));

  return criteria;
};

const getProjectGateCommands = (project: ProjectDiscovery): string[] => {
  const runner = getProjectScriptRunner(project);
  const standardGates = PROJECT_GATE_SCRIPT_NAMES.filter(
    (scriptName) => project.scripts[scriptName] !== undefined
  );
  const namespacedTestGates = Object.keys(project.scripts)
    .filter(isNamespacedTestGate)
    .sort(compareCodeUnits)
    .slice(0, MAX_NAMESPACED_TEST_GATES);

  return [...standardGates, ...namespacedTestGates].map(
    (scriptName) => `${runner} ${scriptName}`
  );
};

const getShadscanCommand = (
  project: ProjectDiscovery,
  category: AuditCategory | undefined
): string => {
  const executor = PACKAGE_EXECUTORS[project.packageManager];
  const categoryOption = category ? ` --category ${category}` : "";
  const projectArgument = getSelectedProjectArgument(project);
  const projectOption = projectArgument ? ` ${projectArgument}` : "";
  const packageSpecifier = `@shadscan/cli@${ENGINE_VERSION}`;
  return `${executor(packageSpecifier)}${projectOption} --json${categoryOption}`;
};

const uniqueEvidence = (actionables: AgentActionable[]): AuditEvidence[] => {
  const evidenceByKey = new Map<string, AuditEvidence>();

  for (const actionable of actionables) {
    for (const evidence of actionable.evidence) {
      const key = `${evidence.filePath ?? ""}:${evidence.line ?? ""}:${evidence.message}`;
      evidenceByKey.set(key, evidence);
    }
  }

  return [...evidenceByKey.values()];
};

const getWorkItemDisposition = (
  actionables: AgentActionable[]
): ActionableDisposition =>
  [...actionables].sort(
    (left, right) =>
      DISPOSITION_ORDER[left.disposition] - DISPOSITION_ORDER[right.disposition]
  )[0]?.disposition ?? "verify";

const getWorkItemPriority = (
  actionables: AgentActionable[]
): ActionablePriority =>
  [...actionables].sort(
    (left, right) =>
      PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
  )[0]?.priority ?? "P2";

const getWorkItemAcceptanceCriteria = ({
  actionables,
  disposition,
  projectGates,
}: {
  actionables: AgentActionable[];
  disposition: ActionableDisposition;
  projectGates: string[];
}): string[] => {
  const findingIds = actionables.map(({ findingId }) => `\`${findingId}\``);

  if (disposition === "verify") {
    return [
      `Record each related finding (${findingIds.join(", ")}) as confirmed, verified-no-change, or unable-to-verify, with rendered or composed evidence.`,
      "Do not edit solely to force score-neutral static advisories to report pass; verified advisories may remain advisory.",
      getProjectGateCriterion(projectGates, "If code changes,"),
    ];
  }

  if (disposition === "decide") {
    return [
      `Record one explicit implement-or-waive product decision covering ${findingIds.join(", ")}.`,
      "If implemented, the related findings should pass; if waived, keep them visible and report the product rationale.",
      "Do not add unused infrastructure solely to increase the audit score.",
      getProjectGateCriterion(projectGates, "If code changes,"),
    ];
  }

  return [
    ...findingIds.map(
      (findingId) =>
        `The shadscan finding ${findingId} reports pass when rerun with the same ruleset and category scope.`
    ),
    "The implementation addresses the user-facing problem described by the related remediations, not only the detector syntax.",
    getProjectGateCriterion(projectGates, "After the change,"),
  ];
};

const createWorkItem = ({
  actionables,
  id,
  projectGates,
  summary,
  title,
}: {
  actionables: AgentActionable[];
  id: string;
  projectGates: string[];
  summary: string;
  title: string;
}): AgentWorkItem => {
  const disposition = getWorkItemDisposition(actionables);
  const suggestedFixes = [
    ...new Set(
      actionables.flatMap(({ suggestedFix }) =>
        suggestedFix ? [suggestedFix] : []
      )
    ),
  ];

  return {
    acceptanceCriteria: getWorkItemAcceptanceCriteria({
      actionables,
      disposition,
      projectGates,
    }),
    categories: AUDIT_CATEGORIES.filter((category) =>
      actionables.some((actionable) => actionable.category === category)
    ),
    disposition,
    evidence: uniqueEvidence(actionables),
    findingIds: actionables.map(({ findingId }) => findingId),
    id,
    priority: getWorkItemPriority(actionables),
    rawScoreImpact: actionables.reduce(
      (total, actionable) => total + actionable.scoreImpact,
      0
    ),
    suggestedFixes,
    summary,
    title,
  };
};

const createWorkItems = (
  actionables: AgentActionable[],
  projectGates: string[]
): AgentWorkItem[] => {
  const groupedFindingIds = new Set<string>();
  const workItems: AgentWorkItem[] = [];

  for (const group of WORK_ITEM_GROUPS) {
    const matchingActionables = group.findingIds.flatMap((findingId) => {
      const actionable = actionables.find(
        (candidate) => candidate.findingId === findingId
      );
      return actionable ? [actionable] : [];
    });

    if (matchingActionables.length < 2) {
      continue;
    }

    const dispositions = new Set(
      matchingActionables.map(({ disposition }) => disposition)
    );

    for (const disposition of dispositions) {
      const groupedActionables = matchingActionables.filter(
        (actionable) => actionable.disposition === disposition
      );

      if (groupedActionables.length < 2) {
        continue;
      }

      for (const actionable of groupedActionables) {
        groupedFindingIds.add(actionable.findingId);
      }
      workItems.push(
        createWorkItem({
          actionables: groupedActionables,
          id: dispositions.size === 1 ? group.id : `${group.id}-${disposition}`,
          projectGates,
          summary: group.summary,
          title: group.title,
        })
      );
    }
  }

  for (const actionable of actionables) {
    if (groupedFindingIds.has(actionable.findingId)) {
      continue;
    }

    workItems.push(
      createWorkItem({
        actionables: [actionable],
        id: actionable.findingId,
        projectGates,
        summary: actionable.summary,
        title: actionable.title,
      })
    );
  }

  return workItems.sort(
    (left, right) =>
      PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
      DISPOSITION_ORDER[left.disposition] -
        DISPOSITION_ORDER[right.disposition] ||
      right.rawScoreImpact - left.rawScoreImpact ||
      compareCodeUnits(left.id, right.id)
  );
};

const getSuggestedSkills = ({
  actionables,
  warnings,
}: {
  actionables: AgentActionable[];
  warnings: string[];
}): string[] => {
  const skills = new Set<string>(["shadscan"]);
  const needsDiagnosis =
    warnings.length > 0 ||
    actionables.some((actionable) => actionable.status === "advisory");
  const needsRegressionThinking = actionables.some(
    (actionable) =>
      actionable.category === "accessibility" || actionable.category === "forms"
  );

  if (needsDiagnosis) {
    skills.add("diagnose");
  }

  if (needsRegressionThinking) {
    skills.add("tdd");
  }

  return [...skills];
};

const createAgentHandoff = ({
  category,
  findings,
  grade,
  project,
  score,
}: {
  category?: AuditCategory;
  findings: AuditFinding[];
  grade: AuditGrade | null;
  project: ProjectDiscovery;
  score: number | null;
}): AgentHandoff => {
  const packageName = project.packageName ?? "the target app";
  const projectGates = getProjectGateCommands(project);
  const actionables = findings
    .filter(
      (
        finding
      ): finding is AuditFinding & {
        status: Extract<AuditRuleStatus, "advisory" | "fail">;
      } => finding.status === "fail" || finding.status === "advisory"
    )
    .map((finding): AgentActionable => {
      const disposition = getActionableDisposition(finding);

      return {
        acceptanceCriteria: getActionableAcceptanceCriteria({
          disposition,
          finding,
          projectGates,
        }),
        category: finding.category,
        confidence: finding.confidence,
        disposition,
        evidence: finding.evidence,
        findingId: finding.id,
        priority: getActionablePriority(finding),
        scoreImpact: finding.impactsScore
          ? finding.maxScore - finding.score
          : 0,
        severity: finding.severity,
        status: finding.status,
        suggestedFix: finding.remediation,
        summary: getActionableSummary(finding, disposition),
        title: getActionableTitle(finding, disposition),
      };
    })
    .sort(
      (left, right) =>
        PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
        right.scoreImpact - left.scoreImpact ||
        compareCodeUnits(left.findingId, right.findingId)
    );
  const goal = (() => {
    if (score === null) {
      return actionables.length === 0
        ? `${packageName}'s shadscan score is unassessed because no score-impacting rules applied; preserve the existing UI and verify the scan scope.`
        : `${packageName}'s shadscan score is unassessed; fix confirmed defects, make explicit product decisions, and verify advisories without unnecessary code changes.`;
    }

    const hasScoreImpactingActionables = actionables.some(
      (actionable) => actionable.scoreImpact > 0
    );

    if (hasScoreImpactingActionables) {
      return `Improve ${packageName} from its ${score}/100 (${grade}) audit baseline by fixing confirmed defects, making explicit product decisions, and verifying advisories without score-driven churn.`;
    }

    return actionables.length === 0
      ? `Keep ${packageName}'s shadscan score at ${score}/100 (${grade}); no missing fundamentals were found.`
      : `Keep ${packageName}'s shadscan score at ${score}/100 (${grade}) while verifying the score-neutral advisories.`;
  })();
  const configPath = project.shadcn.configPath
    ? (getProjectRelativePath(project.rootDir, project.shadcn.configPath) ??
      "outside project")
    : "not found";
  const warnings =
    project.warnings.length === 0 ? "none" : project.warnings.join("; ");

  return {
    actionables,
    context: [
      `Adapter: ${project.framework.adapter}`,
      `Package manager: ${project.packageManager}`,
      `Selected project directory: ${project.selectedProjectPath} (relative to the package-manager root)`,
      `Source coverage: ${project.sourceCoverage}`,
      `shadcn confidence: ${project.shadcn.confidence}; config: ${configPath}`,
      `Warnings: ${warnings}`,
    ],
    goal,
    suggestedSkills: getSuggestedSkills({
      actionables,
      warnings: project.warnings,
    }),
    verification: {
      projectGates,
      shadscanCommand: getShadscanCommand(project, category),
    },
    workItems: createWorkItems(actionables, projectGates),
  };
};

const createAuditReport = ({
  category,
  durationMs,
  findings,
  project,
  rulesetVersion = CUSTOM_RULESET_VERSION,
  source = {
    digest: null,
    kind: "working-tree",
    revision: null,
  },
  workspace,
}: {
  category?: AuditCategory;
  durationMs: number;
  findings: AuditFinding[];
  project: ProjectDiscovery;
  rulesetVersion?: string;
  source?: ScanSource;
  workspace?: WorkspaceReport | null;
}): AuditReport => {
  const normalizedFindings = normalizeFindingPaths(findings, project.rootDir);
  const categories = getCategoryScores(normalizedFindings);
  const score = getTotalScore(categories);
  const grade = score === null ? null : getGrade(score);
  const report: AuditReport = {
    agentHandoff: createAgentHandoff({
      category,
      findings: normalizedFindings,
      grade,
      project,
      score,
    }),
    categories,
    coverage: {
      source: project.sourceCoverage,
    },
    durationMs,
    engineVersion: ENGINE_VERSION,
    findings: normalizedFindings,
    framework: project.framework,
    grade,
    maxScore: 100,
    packageManager: project.packageManager,
    packageName: project.packageName,
    rulesetVersion,
    schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
    score,
    scope: {
      categories: category ? [category] : [...AUDIT_CATEGORIES],
    },
    shadcn: {
      confidence: project.shadcn.confidence,
      configPath: project.shadcn.configPath
        ? (getProjectRelativePath(project.rootDir, project.shadcn.configPath) ??
          null)
        : null,
      style: project.shadcn.style,
    },
    source,
    versions: project.versions,
    warnings: project.warnings,
    workspace: workspace ?? null,
  };

  return AuditReportSchema.parse(report);
};

const runAudit = async (
  cwd: string,
  options: RunAuditOptions
): Promise<AuditReport> => {
  const startedAt = performance.now();
  options.signal?.throwIfAborted();
  const project = await discoverProject(cwd, {
    filesystemRoot: options.filesystemRoot,
  });
  options.signal?.throwIfAborted();
  const context: AuditContext = {
    filesystemRoot: path.resolve(options.filesystemRoot ?? project.rootDir),
    project,
  };
  const findings: AuditFinding[] = [];

  for (const rule of options.rules) {
    options.signal?.throwIfAborted();
    if (!shouldRunRule({ category: options.category, project, rule })) {
      continue;
    }

    findings.push(normalizeFinding(rule, await rule.run(context)));
    options.signal?.throwIfAborted();
  }

  return createAuditReport({
    category: options.category,
    durationMs: Math.round(performance.now() - startedAt),
    findings,
    project,
    rulesetVersion: options.rulesetVersion,
    source: options.source,
  });
};

export type {
  ActionableDisposition,
  ActionablePriority,
  AgentActionable,
  AgentHandoff,
  AgentVerification,
  AgentWorkItem,
  AuditCategory,
  AuditContext,
  AuditEvidence,
  AuditFinding,
  AuditGrade,
  AuditReport,
  AuditRule,
  AuditRuleAdapter,
  AuditRuleResult,
  AuditRuleStatus,
  AuditSeverity,
  RunAuditOptions,
  ScanScope,
  ScanSource,
  ScanSourceKind,
  WorkspaceReport,
  WorkspaceReportProject,
};
export {
  AUDIT_CATEGORIES,
  AUDIT_REPORT_SCHEMA_VERSION,
  AuditReportSchema,
  CATEGORY_DETAILS,
  createAuditReport,
  ENGINE_VERSION,
  getGrade,
  runAudit,
};
