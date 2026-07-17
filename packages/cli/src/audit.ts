import path from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import packageJson from "../package.json";
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

const AUDIT_REPORT_SCHEMA_VERSION = 2 as const;
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
const ActionablePrioritySchema = z.enum(["P0", "P1", "P2"]);
const ConfidenceSchema = z.enum(["high", "medium", "low"]);
const RuleStatusSchema = z.enum(["advisory", "fail", "not-applicable", "pass"]);
const ScanSourceKindSchema = z.enum(["git", "snapshot", "working-tree"]);
const SeveritySchema = z.enum(["error", "info", "warning"]);
type ActionablePriority = z.infer<typeof ActionablePrioritySchema>;
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

interface AuditFinding {
  category: AuditCategory;
  confidence: Confidence;
  description: string;
  evidence: AuditEvidence[];
  id: string;
  impactsScore: boolean;
  maxScore: number;
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

interface AgentHandoff {
  actionables: AgentActionable[];
  context: string[];
  goal: string;
  suggestedSkills: string[];
}

interface AuditReport {
  agentHandoff: AgentHandoff;
  categories: AuditCategoryScore[];
  durationMs: number;
  engineVersion: string;
  findings: AuditFinding[];
  framework: ProjectDiscovery["framework"];
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
}

interface RunAuditOptions {
  category?: AuditCategory;
  rules: AuditRule[];
  rulesetVersion?: string;
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

const AgentHandoffSchema = z.object({
  actionables: z.array(AgentActionableSchema),
  context: z.array(z.string()),
  goal: z.string(),
  suggestedSkills: z.array(z.string()),
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
  durationMs: z.number(),
  engineVersion: z.string().min(1),
  findings: z.array(AuditFindingSchema),
  framework: z.object({
    adapter: z.enum(["generic-react", "next-app-router", "vite-react"]),
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
    next: z.string().nullable(),
    react: z.string().nullable(),
    vite: z.string().nullable(),
  }),
  warnings: z.array(z.string()),
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
        (left.filePath ?? "").localeCompare(right.filePath ?? "") ||
        (left.line ?? 0) - (right.line ?? 0) ||
        left.message.localeCompare(right.message)
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

const getActionablePriority = (finding: AuditFinding): ActionablePriority => {
  if (finding.severity === "error" && finding.status === "fail") {
    return "P0";
  }

  if (finding.status === "fail" && finding.confidence === "high") {
    return "P1";
  }

  return "P2";
};

const getActionableSummary = (finding: AuditFinding): string => {
  if (finding.status === "advisory") {
    return `Verify ${finding.title}; Shadscan has low-confidence evidence and did not reduce the score.`;
  }

  return `Fix ${finding.title}; Shadscan marked this as a ${finding.confidence}-confidence missing UI fundamental.`;
};

const getActionableAcceptanceCriteria = (finding: AuditFinding): string[] => {
  const criteria = [
    `The Shadscan finding \`${finding.id}\` reports pass when rerun with the same ruleset and category scope.`,
  ];

  if (finding.remediation) {
    criteria.push(
      `The implementation matches this remediation: ${finding.remediation}`
    );
  }

  criteria.push(
    "The target app's own lint, typecheck, test, or build gate still passes."
  );

  return criteria;
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
  findings,
  grade,
  project,
  score,
}: {
  findings: AuditFinding[];
  grade: AuditGrade | null;
  project: ProjectDiscovery;
  score: number | null;
}): AgentHandoff => {
  const packageName = project.packageName ?? "the target app";
  const actionables = findings
    .filter(
      (
        finding
      ): finding is AuditFinding & {
        status: Extract<AuditRuleStatus, "advisory" | "fail">;
      } => finding.status === "fail" || finding.status === "advisory"
    )
    .map((finding) => ({
      acceptanceCriteria: getActionableAcceptanceCriteria(finding),
      category: finding.category,
      confidence: finding.confidence,
      evidence: finding.evidence,
      findingId: finding.id,
      priority: getActionablePriority(finding),
      scoreImpact: finding.impactsScore ? finding.maxScore - finding.score : 0,
      severity: finding.severity,
      status: finding.status,
      suggestedFix: finding.remediation,
      summary: getActionableSummary(finding),
      title:
        finding.status === "advisory"
          ? `Verify ${finding.title}`
          : `Fix ${finding.title}`,
    }))
    .sort((left, right) => {
      const priorityOrder: Record<ActionablePriority, number> = {
        P0: 0,
        P1: 1,
        P2: 2,
      };

      return (
        priorityOrder[left.priority] - priorityOrder[right.priority] ||
        right.scoreImpact - left.scoreImpact ||
        left.findingId.localeCompare(right.findingId)
      );
    });
  const goal = (() => {
    if (score === null) {
      return actionables.length === 0
        ? `${packageName}'s Shadscan score is unassessed because no score-impacting rules applied; preserve the existing UI and verify the scan scope.`
        : `${packageName}'s Shadscan score is unassessed; address the agent-ready findings and rerun the same scope.`;
    }

    const hasScoreImpactingActionables = actionables.some(
      (actionable) => actionable.scoreImpact > 0
    );

    if (hasScoreImpactingActionables) {
      return `Raise ${packageName}'s Shadscan score from ${score}/100 (${grade}) by addressing agent-ready UI audit findings.`;
    }

    return actionables.length === 0
      ? `Keep ${packageName}'s Shadscan score at ${score}/100 (${grade}); no missing fundamentals were found.`
      : `Keep ${packageName}'s Shadscan score at ${score}/100 (${grade}) while verifying the score-neutral advisories.`;
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
      `shadcn confidence: ${project.shadcn.confidence}; config: ${configPath}`,
      `Warnings: ${warnings}`,
    ],
    goal,
    suggestedSkills: getSuggestedSkills({
      actionables,
      warnings: project.warnings,
    }),
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
}: {
  category?: AuditCategory;
  durationMs: number;
  findings: AuditFinding[];
  project: ProjectDiscovery;
  rulesetVersion?: string;
  source?: ScanSource;
}): AuditReport => {
  const normalizedFindings = normalizeFindingPaths(findings, project.rootDir);
  const categories = getCategoryScores(normalizedFindings);
  const score = getTotalScore(categories);
  const grade = score === null ? null : getGrade(score);
  const report: AuditReport = {
    agentHandoff: createAgentHandoff({
      findings: normalizedFindings,
      grade,
      project,
      score,
    }),
    categories,
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
  };

  return AuditReportSchema.parse(report);
};

const runAudit = async (
  cwd: string,
  options: RunAuditOptions
): Promise<AuditReport> => {
  const startedAt = performance.now();
  const project = await discoverProject(cwd);
  const context: AuditContext = { project };
  const findings: AuditFinding[] = [];

  for (const rule of options.rules) {
    if (!shouldRunRule({ category: options.category, project, rule })) {
      continue;
    }

    findings.push(normalizeFinding(rule, await rule.run(context)));
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
  ActionablePriority,
  AgentActionable,
  AgentHandoff,
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
