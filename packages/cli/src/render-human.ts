import picocolors from "picocolors";
import type { AuditFinding, AuditReport } from "./audit";
import type { TerminalCapabilities } from "./terminal-capabilities";

interface RenderHumanReportOptions {
  includeRoast: boolean;
  terminal: TerminalCapabilities;
}

const CATEGORY_BAR_WIDTH = 16;
const PLAIN_SCORE_BAR_WIDTH = 16;
const RICH_SCORE_BAR_MAX_WIDTH = 32;
const RICH_SCORE_BAR_INDENT = "  ";
const GOOD_SCORE_THRESHOLD = 90;
const OK_SCORE_THRESHOLD = 70;

type TerminalColors = ReturnType<typeof picocolors.createColors>;

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

const getProgressBar = (
  percentage: number,
  width: number,
  filledCharacter: string,
  emptyCharacter: string
): { empty: string; filled: string } => {
  const clampedPercentage = Math.max(0, Math.min(100, percentage));
  const filledWidth = Math.round((clampedPercentage / 100) * width);

  return {
    empty: emptyCharacter.repeat(width - filledWidth),
    filled: filledCharacter.repeat(filledWidth),
  };
};

const getCategoryBar = (percentage: number | null): string => {
  if (percentage === null) {
    return "-".repeat(CATEGORY_BAR_WIDTH);
  }

  const { empty, filled } = getProgressBar(
    percentage,
    CATEGORY_BAR_WIDTH,
    "#",
    "-"
  );
  return `${filled}${empty}`;
};

const colorizeByScore = (
  value: string,
  score: number,
  colors: TerminalColors
): string => {
  if (score >= GOOD_SCORE_THRESHOLD) {
    return colors.green(value);
  }

  if (score >= OK_SCORE_THRESHOLD) {
    return colors.yellow(value);
  }

  return colors.red(value);
};

const getRichScoreBarWidth = (columns: number | null): number => {
  if (columns === null) {
    return RICH_SCORE_BAR_MAX_WIDTH;
  }

  return Math.max(
    1,
    Math.min(RICH_SCORE_BAR_MAX_WIDTH, columns - RICH_SCORE_BAR_INDENT.length)
  );
};

const renderScoreBar = (
  score: number,
  terminal: TerminalCapabilities,
  colors: TerminalColors
): string => {
  const width = terminal.unicode
    ? getRichScoreBarWidth(terminal.columns)
    : PLAIN_SCORE_BAR_WIDTH;
  const { empty, filled } = getProgressBar(
    score,
    width,
    terminal.unicode ? "█" : "#",
    terminal.unicode ? "░" : "-"
  );
  const renderedBar = `${colorizeByScore(filled, score, colors)}${colors.dim(empty)}`;

  return terminal.unicode ? renderedBar : `[${renderedBar}]`;
};

const renderScoreSummary = (
  report: AuditReport,
  terminal: TerminalCapabilities
): string[] => {
  const colors = picocolors.createColors(terminal.color);

  if (report.score === null) {
    return [`${colors.bold("Your shadscan score:")} unassessed (Grade n/a)`];
  }

  const grade = report.grade ?? "n/a";
  const renderedScore = colorizeByScore(
    `${report.score}/100`,
    report.score,
    colors
  );
  const renderedGrade = colorizeByScore(grade, report.score, colors);
  const scoreBar = renderScoreBar(report.score, terminal, colors);

  if (terminal.unicode) {
    return [
      `${colors.bold("Your shadscan score:")} ${renderedScore} (Grade ${renderedGrade})`,
      `${RICH_SCORE_BAR_INDENT}${scoreBar}`,
    ];
  }

  return [
    `${colors.bold("Your shadscan score:")} ${scoreBar} ${renderedScore} (Grade ${renderedGrade})`,
  ];
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
    "  Verification:",
    `    - shadscan: ${sanitizeTerminalText(report.agentHandoff.verification.shadscanCommand)}`,
    ...(report.agentHandoff.verification.projectGates.length > 0
      ? report.agentHandoff.verification.projectGates.map(
          (command) => `    - Project gate: ${sanitizeTerminalText(command)}`
        )
      : [
          "    - Project gates: inspect package scripts; none were discovered.",
        ]),
    "  Work items:",
  ];

  if (report.agentHandoff.workItems.length === 0) {
    lines.push("    - None. Keep the existing fundamentals intact.");

    return lines;
  }

  for (const [index, workItem] of report.agentHandoff.workItems.entries()) {
    lines.push(
      `    ${index + 1}. [${workItem.priority}] ${sanitizeTerminalText(workItem.title)}`,
      `       Disposition: ${workItem.disposition}`,
      `       Findings: ${workItem.findingIds.map(sanitizeTerminalText).join(", ")}`,
      `       Categories: ${workItem.categories.map(sanitizeTerminalText).join(", ")}`,
      `       Summary: ${sanitizeTerminalText(workItem.summary)}`
    );

    if (workItem.rawScoreImpact > 0) {
      lines.push(
        `       Score impact: ${workItem.rawScoreImpact} raw rule points`
      );
    }

    for (const suggestedFix of workItem.suggestedFixes) {
      lines.push(`       Suggested fix: ${sanitizeTerminalText(suggestedFix)}`);
    }

    lines.push(
      `       Acceptance: ${workItem.acceptanceCriteria.map(sanitizeTerminalText).join(" ")}`
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
    ...renderScoreSummary(report, options.terminal),
    "shadscan has entered the chat.",
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

export { renderHumanReport, sanitizeTerminalText, stripRoasts };
