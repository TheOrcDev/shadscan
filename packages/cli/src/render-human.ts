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
    `Your Shadcn app score: ${report.score}/100`,
    `Grade: ${report.grade}`,
    "Headless Shadcn has entered the chat.",
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
