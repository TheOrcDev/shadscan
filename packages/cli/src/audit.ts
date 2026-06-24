import { performance } from "node:perf_hooks";
import { z } from "zod";
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
const SeveritySchema = z.enum(["error", "info", "warning"]);
type ActionablePriority = z.infer<typeof ActionablePrioritySchema>;
type AuditCategory = (typeof AUDIT_CATEGORIES)[number];
type AuditRuleAdapter = "core" | FrameworkAdapter;
type AuditRuleStatus = z.infer<typeof RuleStatusSchema>;
type AuditSeverity = z.infer<typeof SeveritySchema>;
type AuditGrade = "A" | "B" | "C" | "D" | "F";

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
  findings: AuditFinding[];
  framework: ProjectDiscovery["framework"];
  grade: AuditGrade;
  maxScore: 100;
  packageManager: ProjectDiscovery["packageManager"];
  packageName: string | null;
  score: number;
  shadcn: Pick<
    ProjectDiscovery["shadcn"],
    "confidence" | "configPath" | "style"
  >;
  versions: ProjectDiscovery["versions"];
  warnings: string[];
}

interface RunAuditOptions {
  category?: AuditCategory;
  rules?: AuditRule[];
}

const AuditEvidenceSchema = z.object({
  filePath: z.string().optional(),
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
  findings: z.array(AuditFindingSchema),
  framework: z.object({
    adapter: z.enum(["generic-react", "next-app-router", "vite-react"]),
    evidence: z.array(z.string()),
  }),
  grade: z.enum(["A", "B", "C", "D", "F"]),
  maxScore: z.literal(100),
  packageManager: z.enum(["bun", "npm", "pnpm", "unknown", "yarn"]),
  packageName: z.string().nullable(),
  score: z.number().min(0).max(100),
  shadcn: z.object({
    confidence: ConfidenceSchema,
    configPath: z.string().nullable(),
    style: z.string().nullable(),
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
  const impactsScore = status !== "advisory" && status !== "not-applicable";
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
      (finding) => finding.status !== "not-applicable"
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
      score: ratio === null ? 0 : Math.round(ratio * weight),
      title: CATEGORY_DETAILS[category].title,
      weight,
    };
  });

const getTotalScore = (categories: AuditCategoryScore[]): number => {
  const applicableCategories = categories.filter(
    (category) => category.applicable
  );
  const activeWeight = applicableCategories.reduce(
    (total, category) => total + category.weight,
    0
  );

  if (activeWeight === 0) {
    return 100;
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
    `The Shadscan finding \`${finding.id}\` reports pass or no longer appears as ${finding.status}.`,
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
  grade: AuditGrade;
  project: ProjectDiscovery;
  score: number;
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
  const goal =
    actionables.length === 0
      ? `Keep ${packageName}'s Shadscan score at ${score}/100 (${grade}); no missing fundamentals were found.`
      : `Raise ${packageName}'s Shadscan score from ${score}/100 (${grade}) by addressing agent-ready UI audit findings.`;
  const configPath = project.shadcn.configPath ?? "not found";
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
  durationMs,
  findings,
  project,
}: {
  durationMs: number;
  findings: AuditFinding[];
  project: ProjectDiscovery;
}): AuditReport => {
  const categories = getCategoryScores(findings);
  const score = getTotalScore(categories);
  const grade = getGrade(score);
  const report: AuditReport = {
    agentHandoff: createAgentHandoff({
      findings,
      grade,
      project,
      score,
    }),
    categories,
    durationMs,
    findings,
    framework: project.framework,
    grade,
    maxScore: 100,
    packageManager: project.packageManager,
    packageName: project.packageName,
    score,
    shadcn: {
      confidence: project.shadcn.confidence,
      configPath: project.shadcn.configPath,
      style: project.shadcn.style,
    },
    versions: project.versions,
    warnings: project.warnings,
  };

  return AuditReportSchema.parse(report);
};

const runAudit = async (
  cwd: string,
  options: RunAuditOptions = {}
): Promise<AuditReport> => {
  const startedAt = performance.now();
  const project = await discoverProject(cwd);
  const rules = options.rules ?? [];
  const context: AuditContext = { project };
  const findings: AuditFinding[] = [];

  for (const rule of rules) {
    if (!shouldRunRule({ category: options.category, project, rule })) {
      continue;
    }

    findings.push(normalizeFinding(rule, await rule.run(context)));
  }

  return createAuditReport({
    durationMs: Math.round(performance.now() - startedAt),
    findings,
    project,
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
};
export {
  AUDIT_CATEGORIES,
  AuditReportSchema,
  CATEGORY_DETAILS,
  createAuditReport,
  getGrade,
  runAudit,
};
