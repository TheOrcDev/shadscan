import picocolors from "picocolors";
import { sanitizeTerminalText } from "../render-human";
import type { TerminalCapabilities } from "../terminal-capabilities";
import type {
  OverflowCheckReport,
  OverflowMeasurement,
  OverflowViewport,
} from "./contracts";

interface RenderOverflowCheckReportOptions {
  terminal: TerminalCapabilities;
}

const renderViewport = (
  viewport: OverflowViewport,
  terminal: TerminalCapabilities
): string => {
  const separator = terminal.unicode ? "×" : "x";
  return `${viewport.name} (${viewport.width}${separator}${viewport.height})`;
};

const getOverflowReason = (measurement: OverflowMeasurement): string => {
  if (!measurement.forcedScrollbar) {
    return `${measurement.overflowPx}px overflow`;
  }

  if (measurement.overflowPx > 0) {
    return `${measurement.overflowPx}px overflow; root scrollbar forced`;
  }

  return "root scrollbar forced";
};

const renderFailure = (
  measurement: OverflowMeasurement,
  terminal: TerminalCapabilities
): string[] => {
  const separator = terminal.unicode ? "×" : "x";
  const divider = terminal.unicode ? "—" : "-";
  const overflowReason = getOverflowReason(measurement);
  const lines = [
    `  ${sanitizeTerminalText(measurement.page)} ${divider} ${measurement.viewport.name} ${measurement.viewport.width}${separator}${measurement.viewport.height}`,
    `    ${measurement.scrollWidth}px document / ${measurement.clientWidth}px viewport (${overflowReason})`,
  ];

  for (const culprit of measurement.culprits) {
    lines.push(
      `    Likely culprit: ${sanitizeTerminalText(culprit.descriptor)} (${culprit.overflowPx}px)`
    );
  }

  if (measurement.omittedCulprits > 0) {
    lines.push(`    ${measurement.omittedCulprits} more culprits omitted`);
  }

  return lines;
};

const renderOverflowCheckReport = (
  report: OverflowCheckReport,
  options: RenderOverflowCheckReportOptions
): string => {
  const colors = picocolors.createColors(options.terminal.color);
  const status =
    report.status === "pass"
      ? colors.green(colors.bold("PASS"))
      : colors.red(colors.bold("CRITICAL FAIL"));
  const lines = [
    colors.bold("shadscan overflow check"),
    "",
    status,
    `Target: ${sanitizeTerminalText(report.target.origin)}`,
    `Viewports: ${report.viewports
      .map((viewport) => renderViewport(viewport, options.terminal))
      .join(", ")}`,
    `Pages: ${report.target.pages.map(sanitizeTerminalText).join(", ")}`,
  ];

  if (report.status === "pass") {
    lines.push(
      "",
      `No horizontal overflow detected across ${report.summary.measurements} measurements.`
    );
  } else {
    lines.push("", "Failed measurements:");
    for (const measurement of report.results) {
      if (measurement.status === "fail") {
        lines.push(...renderFailure(measurement, options.terminal));
      }
    }
    lines.push(
      "",
      `Remediation: ${sanitizeTerminalText(report.remediation ?? "")}`
    );
  }

  return `${lines.join("\n")}\n`;
};

export type { RenderOverflowCheckReportOptions };
export { renderOverflowCheckReport };
