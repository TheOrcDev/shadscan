import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { findProjectFiles, getTextLineNumber } from "./source-files";

const RETRY_CALLBACK_PATTERN =
  /\b(?:unstable_retry|resetErrorBoundary|reset|onRetry|retry)\b/;
const RETRY_CONTROL_PATTERN =
  /<(?:button|Button)\b[^>]*onClick\s*=\s*\{[^}]*(?:unstable_retry|resetErrorBoundary|reset|onRetry|retry)/i;
const ERROR_COMPONENT_PATTERN = /export\s+default|class\s+\w*ErrorBoundary/;

const getErrorFilePatterns = (
  rootDir: string,
  appDir: string | null
): string[] => {
  const patterns = [
    "src/**/*error-boundary.{js,jsx,ts,tsx}",
    "components/**/*error-boundary.{js,jsx,ts,tsx}",
    "src/**/*ErrorBoundary.{js,jsx,ts,tsx}",
    "components/**/*ErrorBoundary.{js,jsx,ts,tsx}",
  ];

  if (appDir) {
    const relativeAppDir = path.relative(rootDir, appDir);
    patterns.push(
      path.join(relativeAppDir, "**/error.{js,jsx,ts,tsx}"),
      path.join(relativeAppDir, "error.{js,jsx,ts,tsx}"),
      path.join(relativeAppDir, "global-error.{js,jsx,ts,tsx}")
    );
  }

  return patterns;
};

const errorStateRetryPresentRule: AuditRule = {
  adapters: ["core"],
  category: "states",
  confidence: "high",
  description: "Checks detected error UI for a wired retry control.",
  id: "error-state-retry-present",
  maxScore: 4,
  run: async ({ project }) => {
    const errorFiles = await findProjectFiles(
      project,
      getErrorFilePatterns(project.rootDir, project.paths.appDir)
    );

    if (errorFiles.length === 0) {
      return notApplicable("No error UI file was found to inspect.");
    }

    for (const filePath of errorFiles) {
      const content = await readFile(filePath, "utf8");
      const hasRetryCallback = RETRY_CALLBACK_PATTERN.test(content);
      const hasRetryControl = RETRY_CONTROL_PATTERN.test(content);

      if (hasRetryCallback && hasRetryControl) {
        continue;
      }

      return fail(
        "Error UI has no wired retry control.",
        "Render a button that invokes unstable_retry, reset, resetErrorBoundary, or an equivalent retry callback.",
        {
          filePath,
          line: getTextLineNumber(content, ERROR_COMPONENT_PATTERN),
        }
      );
    }

    return pass(
      `All ${errorFiles.length} detected error surfaces provide recovery.`
    );
  },
  severity: "error",
  title: "error states provide retry recovery",
};

export { errorStateRetryPresentRule };
