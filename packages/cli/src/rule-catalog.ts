import type {
  AuditCategory,
  AuditRule,
  AuditRuleAdapter,
  AuditSeverity,
} from "./audit";
import { defaultRules } from "./rules/default-rules";

interface RuleCatalogEntry {
  readonly adapters: readonly AuditRuleAdapter[];
  readonly category: AuditCategory;
  readonly confidence: AuditRule["confidence"];
  readonly description: string;
  readonly id: string;
  readonly maxScore: number;
  readonly severity: AuditSeverity;
  readonly title: string;
}

const toCatalogEntry = (rule: AuditRule): RuleCatalogEntry =>
  Object.freeze({
    adapters: Object.freeze([...rule.adapters]),
    category: rule.category,
    confidence: rule.confidence,
    description: rule.description,
    id: rule.id,
    maxScore: rule.maxScore,
    severity: rule.severity,
    title: rule.title,
  });

const RULE_CATALOG: readonly RuleCatalogEntry[] = Object.freeze(
  defaultRules.map(toCatalogEntry)
);

export type { RuleCatalogEntry };
export { RULE_CATALOG };
