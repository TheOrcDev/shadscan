import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { findFiles, getTextLineNumber } from "./source-files";

const RECOVERY_CONTROL_PATTERN =
  /<(?:a|Link)\b[^>]*href=|<(?:button|Button)\b[^>]*onClick\s*=\s*\{[^}]*(?:back|push|replace)|<(?:form|Search|SearchInput)(?:\s|>)/i;
const NOT_FOUND_COMPONENT_PATTERN = /export\s+default/;

const notFoundRecoveryPresentRule: AuditRule = {
  adapters: ["next-app-router"],
  category: "states",
  confidence: "high",
  description:
    "Checks Next not-found UI for a navigation or search recovery path.",
  id: "not-found-recovery-present",
  maxScore: 3,
  run: async ({ project }) => {
    const appDir = project.paths.appDir;

    if (!appDir) {
      return notApplicable("No Next App Router directory was found.");
    }

    const relativeAppDir = path.relative(project.rootDir, appDir);
    const notFoundFiles = await findFiles(project.rootDir, [
      path.join(relativeAppDir, "not-found.{js,jsx,ts,tsx}"),
      path.join(relativeAppDir, "**/not-found.{js,jsx,ts,tsx}"),
    ]);

    if (notFoundFiles.length === 0) {
      return notApplicable("No Next not-found UI file was found.");
    }

    for (const filePath of notFoundFiles) {
      const content = await readFile(filePath, "utf8");

      if (RECOVERY_CONTROL_PATTERN.test(content)) {
        continue;
      }

      return fail(
        "Not-found UI has no navigation, back, or search recovery action.",
        "Add a link home, a back action, or a search control to the not-found state.",
        {
          filePath,
          line: getTextLineNumber(content, NOT_FOUND_COMPONENT_PATTERN),
        }
      );
    }

    return pass(
      `All ${notFoundFiles.length} not-found surfaces offer recovery.`
    );
  },
  severity: "warning",
  title: "not-found states provide recovery",
};

export { notFoundRecoveryPresentRule };
