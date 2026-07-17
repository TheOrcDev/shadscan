import type { AuditEvidence, AuditRuleResult } from "../audit";

const createEvidence = (
  message: string,
  filePath?: string,
  line?: number
): AuditEvidence[] => [
  {
    filePath,
    line,
    message,
  },
];

const pass = (
  message: string,
  filePath?: string,
  line?: number
): AuditRuleResult => ({
  evidence: createEvidence(message, filePath, line),
  status: "pass",
});

const fail = (
  message: string,
  remediation: string,
  options: {
    filePath?: string;
    line?: number;
    roast?: string;
  } = {}
): AuditRuleResult => ({
  evidence: createEvidence(message, options.filePath, options.line),
  remediation,
  roast: options.roast,
  status: "fail",
});

const advisory = (
  message: string,
  remediation: string,
  filePath?: string,
  line?: number
): AuditRuleResult => ({
  confidence: "low",
  evidence: createEvidence(message, filePath, line),
  remediation,
  status: "advisory",
});

const notApplicable = (message: string): AuditRuleResult => ({
  evidence: createEvidence(message),
  status: "not-applicable",
});

export { advisory, createEvidence, fail, notApplicable, pass };
