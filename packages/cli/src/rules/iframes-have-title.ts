import {
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isStringLiteral,
} from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, pass } from "./rule-result";

const hasIframeTitle = (
  node: import("typescript").JsxOpeningLikeElement
): boolean => {
  for (const property of node.attributes.properties) {
    if (!isJsxAttribute(property) || property.name.getText() !== "title") {
      continue;
    }

    const initializer = property.initializer;

    if (initializer && isStringLiteral(initializer)) {
      return initializer.text.trim().length > 0;
    }

    return Boolean(
      initializer && isJsxExpression(initializer) && initializer.expression
    );
  }

  return false;
};

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

    visitJsxNodes(files, ({ file, node }) => {
      if (failure || isJsxElement(node) || getJsxTagName(node) !== "iframe") {
        return;
      }

      if (hasIframeTitle(node)) {
        return;
      }

      failure = fail(
        "Iframe is missing a meaningful title.",
        "Add a concise title that identifies the embedded content.",
        { filePath: file.filePath, line: getLineNumber(file, node) }
      );
    });

    return failure ?? pass("No untitled iframes were found.");
  },
  severity: "error",
  title: "iframes have titles",
};

export { iframesHaveTitleRule };
