import { isJsxElement } from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  getTextAttributeState,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { advisory, fail, pass } from "./rule-result";

const iframesHaveTitleRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description: "Checks iframe elements for a meaningful title attribute.",
  id: "iframes-have-title",
  maxScore: 2,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    let failure: AuditRuleResult | null = null;
    let uncertainResult: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ file, node }) => {
      if (failure || isJsxElement(node) || getJsxTagName(node) !== "iframe") {
        return;
      }

      const titleState = getTextAttributeState(node, "title");

      if (titleState === "valid") {
        return;
      }

      if (titleState === "unknown") {
        uncertainResult ??= advisory(
          "Iframe uses a dynamic title that cannot be verified statically.",
          "Ensure the title always resolves to concise, meaningful text.",
          file.filePath,
          getLineNumber(file, node)
        );
        return;
      }

      failure = fail(
        "Iframe is missing a meaningful title.",
        "Add a concise title that identifies the embedded content.",
        { filePath: file.filePath, line: getLineNumber(file, node) }
      );
    });

    return (
      failure ?? uncertainResult ?? pass("No untitled iframes were found.")
    );
  },
  severity: "error",
  title: "iframes have titles",
};

export { iframesHaveTitleRule };
