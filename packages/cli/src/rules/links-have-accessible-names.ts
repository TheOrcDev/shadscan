import {
  isJsxElement,
  isJsxExpression,
  isJsxSelfClosingElement,
  isJsxText,
  type JsxChild,
} from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  hasJsxAttribute,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, pass } from "./rule-result";

const LINK_TAGS = new Set(["Link", "a"]);

const childProvidesName = (child: JsxChild): boolean => {
  if (isJsxText(child)) {
    return child.getText().trim().length > 0;
  }

  if (isJsxExpression(child)) {
    return Boolean(child.expression);
  }

  if (isJsxSelfClosingElement(child)) {
    const tagName = getJsxTagName(child);
    return (
      (tagName === "Image" || tagName === "img") &&
      hasJsxAttribute(child, "alt")
    );
  }

  if (isJsxElement(child)) {
    return (
      hasJsxAttribute(child.openingElement, "aria-label") ||
      child.children.some((nestedChild) => childProvidesName(nestedChild))
    );
  }

  return false;
};

const linksHaveAccessibleNamesRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description: "Checks native and Next links for an accessible name.",
  id: "links-have-accessible-names",
  maxScore: 3,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    let failure: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ file, node }) => {
      if (failure || !(isJsxElement(node) || isJsxSelfClosingElement(node))) {
        return;
      }

      const openingElement = isJsxElement(node) ? node.openingElement : node;
      const tagName = getJsxTagName(openingElement);

      if (!(tagName && LINK_TAGS.has(tagName))) {
        return;
      }

      if (
        hasJsxAttribute(openingElement, "aria-label") ||
        hasJsxAttribute(openingElement, "aria-labelledby") ||
        hasJsxAttribute(openingElement, "title") ||
        (isJsxElement(node) &&
          node.children.some((child) => childProvidesName(child)))
      ) {
        return;
      }

      failure = fail(
        "Link has no accessible name.",
        "Add meaningful text, an aria-label/aria-labelledby value, or labeled image content.",
        { filePath: file.filePath, line: getLineNumber(file, openingElement) }
      );
    });

    return failure ?? pass("No unnamed links were found.");
  },
  severity: "error",
  title: "links have accessible names",
};

export { linksHaveAccessibleNamesRule };
