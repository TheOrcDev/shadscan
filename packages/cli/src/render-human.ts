import type { AuditFinding, AuditReport } from "./audit";

interface RenderHumanReportOptions {
  includeRoast: boolean;
}

const BAR_WIDTH = 16;

const isUnsafeTerminalCodePoint = (codePoint: number): boolean =>
  codePoint <= 0x1f ||
  (codePoint >= 0x7f && codePoint <= 0x9f) ||
  (codePoint >= 0x20_28 && codePoint <= 0x20_2e) ||
  (codePoint >= 0x20_66 && codePoint <= 0x20_69);

const sanitizeTerminalText = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && isUnsafeTerminalCodePoint(codePoint)
      ? " "
      : character;
  }).join("");

const formatCategoryScore = (score: number): string =>
  Number.isInteger(score) ? String(score) : score.toFixed(1);

const getCategoryBar = (percentage: number | null): string => {
  if (percentage === null) {
    return "-".repeat(BAR_WIDTH);
  }

  const filled = Math.round((percentage / 100) * BAR_WIDTH);
  return `${"#".repeat(filled)}${"-".repeat(BAR_WIDTH - filled)}`;
};

const getFindingLabel = (finding: AuditFinding): string => {
  if (finding.status === "advisory") {
    return "Worth checking";
  }

  return finding.status === "fail" ? "Missing" : "Passed";
};

const renderEvidence = (finding: AuditFinding): string[] =>
  finding.evidence.map((evidence) => {
    const location = evidence.filePath
      ? ` (${evidence.filePath}${evidence.line ? `:${evidence.line}` : ""})`
      : "";

    return `  Evidence: ${sanitizeTerminalText(evidence.message)}${sanitizeTerminalText(location)}`;
  });

const getActionableFindings = (report: AuditReport): AuditFinding[] =>
  report.findings.filter(
    (finding) => finding.status === "fail" || finding.status === "advisory"
  );

const renderCategories = (report: AuditReport): string[] =>
  report.categories.map((category) => {
    const score = category.applicable
      ? `${formatCategoryScore(category.score)}/${category.maxScore}`
      : "n/a";
    const percentage =
      category.percentage === null ? "n/a" : `${category.percentage}%`;

    return `  ${category.title}: [${getCategoryBar(category.percentage)}] ${score} (${percentage})`;
  });

const renderFindings = (
  report: AuditReport,
  options: RenderHumanReportOptions
): string[] => {
  const actionableFindings = getActionableFindings(report);

  if (actionableFindings.length === 0) {
    return ["", "No missing fundamentals found."];
  }

  const lines = ["", "Findings:"];

  for (const finding of actionableFindings) {
    lines.push(
      "",
      `${getFindingLabel(finding)}: ${sanitizeTerminalText(finding.title)}`,
      ...renderEvidence(finding)
    );

    if (finding.remediation) {
      lines.push(`  Fix: ${sanitizeTerminalText(finding.remediation)}`);
    }

    if (options.includeRoast && finding.roast) {
      lines.push(`  ${sanitizeTerminalText(finding.roast)}`);
    }
  }

  return lines;
};

const renderWarnings = (report: AuditReport): string[] => {
  if (report.warnings.length === 0) {
    return [];
  }

  return [
    "",
    "Warnings:",
    ...report.warnings.map((warning) => `  ${sanitizeTerminalText(warning)}`),
  ];
};

const renderAgentHandoff = (report: AuditReport): string[] => {
  const lines = [
    "",
    "Agent handoff:",
    `  Goal: ${sanitizeTerminalText(report.agentHandoff.goal)}`,
    `  Suggested skills: ${report.agentHandoff.suggestedSkills.map(sanitizeTerminalText).join(", ")}`,
    "  Context:",
    ...report.agentHandoff.context.map(
      (context) => `    - ${sanitizeTerminalText(context)}`
    ),
    "  Actionables:",
  ];

  if (report.agentHandoff.actionables.length === 0) {
    lines.push("    - None. Keep the existing fundamentals intact.");

    return lines;
  }

  for (const [index, actionable] of report.agentHandoff.actionables.entries()) {
    lines.push(
      `    ${index + 1}. [${actionable.priority}] ${sanitizeTerminalText(actionable.title)}`,
      `       Finding: ${sanitizeTerminalText(actionable.findingId)} (${actionable.status}, ${actionable.confidence} confidence, ${actionable.category})`,
      `       Summary: ${sanitizeTerminalText(actionable.summary)}`
    );

    if (actionable.scoreImpact > 0) {
      lines.push(`       Score impact: ${actionable.scoreImpact} raw points`);
    }

    if (actionable.suggestedFix) {
      lines.push(
        `       Fix: ${sanitizeTerminalText(actionable.suggestedFix)}`
      );
    }

    lines.push(
      `       Acceptance: ${actionable.acceptanceCriteria.map(sanitizeTerminalText).join(" ")}`
    );
  }

  return lines;
};

const stripRoasts = (report: AuditReport): AuditReport => ({
  ...report,
  findings: report.findings.map((finding) => ({
    ...finding,
    roast: null,
  })),
});

const renderHumanReport = (
  report: AuditReport,
  options: RenderHumanReportOptions
): string => {
  const lines: string[] = [
    `Your Shadscan score: ${report.score === null ? "unassessed" : `${report.score}/100`}`,
    `Grade: ${report.grade ?? "n/a"}`,
    "Shadscan has entered the chat.",
    "",
    `Adapter: ${report.framework.adapter}`,
    `Package: ${sanitizeTerminalText(report.packageName ?? "unknown")}`,
    "",
    "Categories:",
    ...renderCategories(report),
    ...renderFindings(report, options),
    ...renderAgentHandoff(report),
    ...renderWarnings(report),
  ];

  return `${lines.join("\n")}\n`;
};

export { renderHumanReport, stripRoasts };
