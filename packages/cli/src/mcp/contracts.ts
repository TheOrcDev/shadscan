import { z } from "zod";
import { AUDIT_CATEGORIES } from "../audit";

/**
 * MCP is the fourth consumer of the report shape (CLI, hosted API, GitHub
 * Action, MCP). Tool responses are derived subsets validated here at the
 * boundary, so a future report-schema bump fails loudly in this file instead
 * of silently changing tool output.
 */

const SEVERITIES = ["error", "warning"] as const;

const ScanInputSchema = z.object({
  category: z.enum(AUDIT_CATEGORIES).optional(),
  full: z.boolean().optional(),
  packageDir: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  severity: z.enum(SEVERITIES).optional(),
});

const ListProjectsInputSchema = z.object({
  path: z.string().min(1).optional(),
});

const ExplainRuleInputSchema = z.object({
  ruleId: z.string().min(1),
});

const VersionsSchema = z.object({
  engineVersion: z.string(),
  rulesetVersion: z.string(),
  schemaVersion: z.number(),
});

const ActionableSummarySchema = z.object({
  acceptanceCriteria: z.array(z.string()),
  category: z.string(),
  evidence: z
    .object({
      filePath: z.string().optional(),
      line: z.number().optional(),
      message: z.string(),
    })
    .nullable(),
  findingId: z.string(),
  packageDir: z.string().nullable(),
  priority: z.string(),
  scoreImpact: z.number(),
  severity: z.string(),
  status: z.string(),
  suggestedFix: z.string().nullable(),
  title: z.string(),
});

const ScanResultSchema = VersionsSchema.extend({
  actionables: z.array(ActionableSummarySchema),
  /** Set when the actionable list was capped; explains what was kept. */
  actionablesNote: z.string().nullable(),
  countsByCategory: z.record(z.string(), z.number()),
  findings: z.array(z.unknown()).nullable(),
  grade: z.string().nullable(),
  packageDirs: z.array(z.string()).nullable(),
  score: z.number().nullable(),
  scannedPath: z.string(),
  workspace: z
    .object({
      applicationCount: z.number(),
      kind: z.string(),
      skippedCount: z.number(),
    })
    .nullable(),
});

const ListProjectsResultSchema = VersionsSchema.omit({
  schemaVersion: true,
}).extend({
  kind: z.string(),
  projects: z.array(
    z.object({
      adapter: z.string(),
      kind: z.string(),
      kindReason: z.string(),
      packageDir: z.string(),
      packageName: z.string().nullable(),
    })
  ),
  scannedPath: z.string(),
  skipped: z.array(z.object({ packageDir: z.string(), reason: z.string() })),
  truncated: z.number(),
});

const ExplainRuleResultSchema = z.object({
  adapters: z.array(z.string()),
  category: z.string(),
  confidence: z.string(),
  description: z.string(),
  id: z.string(),
  title: z.string(),
});

type ScanInput = z.infer<typeof ScanInputSchema>;
type ScanResult = z.infer<typeof ScanResultSchema>;
type ListProjectsInput = z.infer<typeof ListProjectsInputSchema>;
type ListProjectsResult = z.infer<typeof ListProjectsResultSchema>;
type ExplainRuleInput = z.infer<typeof ExplainRuleInputSchema>;
type ExplainRuleResult = z.infer<typeof ExplainRuleResultSchema>;

export type {
  ExplainRuleInput,
  ExplainRuleResult,
  ListProjectsInput,
  ListProjectsResult,
  ScanInput,
  ScanResult,
};
export {
  ExplainRuleInputSchema,
  ExplainRuleResultSchema,
  ListProjectsInputSchema,
  ListProjectsResultSchema,
  ScanInputSchema,
  ScanResultSchema,
};
