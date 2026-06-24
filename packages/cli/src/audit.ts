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
const ConfidenceSchema = z.enum(["high", "medium", "low"]);
const RuleStatusSchema = z.enum(["advisory", "fail", "not-applicable", "pass"]);
const SeveritySchema = z.enum(["error", "info", "warning"]);
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

interface AuditReport {
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

const AuditReportSchema = z.object({
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
  const report: AuditReport = {
    categories,
    durationMs,
    findings,
    framework: project.framework,
    grade: getGrade(score),
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
