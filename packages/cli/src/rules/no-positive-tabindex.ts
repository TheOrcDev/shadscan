import {
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isNumericLiteral,
  isStringLiteral,
  type JsxAttribute,
} from "typescript";
import { getLineNumber, parseProjectSourceFiles, visitJsxNodes } from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, pass } from "./rule-result";

const getPositiveTabIndex = (attribute: JsxAttribute): number | null => {
  const initializer = attribute.initializer;

  if (!initializer) {
    return null;
  }

  if (isStringLiteral(initializer)) {
    const value = Number(initializer.text);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (
    isJsxExpression(initializer) &&
    initializer.expression &&
    isNumericLiteral(initializer.expression)
  ) {
    const value = Number(initializer.expression.text);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  return null;
};

const noPositiveTabindexRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description: "Checks JSX for positive literal tabIndex values.",
  id: "no-positive-tabindex",
  maxScore: 2,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    let failure: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ file, node }) => {
      if (failure || isJsxElement(node)) {
        return;
      }

      for (const property of node.attributes.properties) {
        if (
          !isJsxAttribute(property) ||
          property.name.getText() !== "tabIndex"
        ) {
          continue;
        }

        const value = getPositiveTabIndex(property);

        if (value === null) {
          continue;
        }

        failure = fail(
          `Positive tabIndex=${value} overrides the document focus order.`,
          "Use semantic document order with tabIndex=0, or tabIndex=-1 for programmatic focus.",
          { filePath: file.filePath, line: getLineNumber(file, property) }
        );
      }
    });

    return failure ?? pass("No positive literal tabIndex values were found.");
  },
  severity: "error",
  title: "focus order avoids positive tabIndex",
};

export { noPositiveTabindexRule };
