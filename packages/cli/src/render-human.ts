import type { AuditFinding, AuditReport } from "./audit";

interface RenderHumanReportOptions {
  includeRoast: boolean;
}

const BAR_WIDTH = 16;

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

    return `  Evidence: ${evidence.message}${location}`;
  });

const getActionableFindings = (report: AuditReport): AuditFinding[] =>
  report.findings.filter(
    (finding) => finding.status === "fail" || finding.status === "advisory"
  );

const renderAgentHandoff = (report: AuditReport): string[] => {
  const lines = [
    "",
    "Agent handoff:",
    `  Goal: ${report.agentHandoff.goal}`,
    `  Suggested skills: ${report.agentHandoff.suggestedSkills.join(", ")}`,
    "  Context:",
    ...report.agentHandoff.context.map((context) => `    - ${context}`),
    "  Actionables:",
  ];

  if (report.agentHandoff.actionables.length === 0) {
    lines.push("    - None. Keep the existing fundamentals intact.");

    return lines;
  }

  for (const [index, actionable] of report.agentHandoff.actionables.entries()) {
    lines.push(
      `    ${index + 1}. [${actionable.priority}] ${actionable.title}`,
      `       Finding: ${actionable.findingId} (${actionable.status}, ${actionable.confidence} confidence, ${actionable.category})`,
      `       Summary: ${actionable.summary}`
    );

    if (actionable.scoreImpact > 0) {
      lines.push(`       Score impact: ${actionable.scoreImpact} raw points`);
    }

    if (actionable.suggestedFix) {
      lines.push(`       Fix: ${actionable.suggestedFix}`);
    }

    lines.push(`       Acceptance: ${actionable.acceptanceCriteria.join(" ")}`);
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
    `Your Shadscan score: ${report.score}/100`,
    `Grade: ${report.grade}`,
    "Shadscan has entered the chat.",
    "",
    `Adapter: ${report.framework.adapter}`,
    `Package: ${report.packageName ?? "unknown"}`,
    "",
    "Categories:",
  ];

  for (const category of report.categories) {
    const score = category.applicable
      ? `${category.score}/${category.maxScore}`
      : "n/a";
    const percentage =
      category.percentage === null ? "n/a" : `${category.percentage}%`;
    lines.push(
      `  ${category.title}: [${getCategoryBar(category.percentage)}] ${score} (${percentage})`
    );
  }

  const actionableFindings = getActionableFindings(report);

  lines.push("");

  if (actionableFindings.length === 0) {
    lines.push("No missing fundamentals found.");
  } else {
    lines.push("Findings:");

    for (const finding of actionableFindings) {
      lines.push("");
      lines.push(`${getFindingLabel(finding)}: ${finding.title}`);
      lines.push(...renderEvidence(finding));

      if (finding.remediation) {
        lines.push(`  Fix: ${finding.remediation}`);
      }

      if (options.includeRoast && finding.roast) {
        lines.push(`  ${finding.roast}`);
      }
    }
  }

  lines.push(...renderAgentHandoff(report));

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");

    for (const warning of report.warnings) {
      lines.push(`  ${warning}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

export { renderHumanReport, stripRoasts };
