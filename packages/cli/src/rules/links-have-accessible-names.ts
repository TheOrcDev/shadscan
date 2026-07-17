import {
  isJsxElement,
  isJsxSelfClosingElement,
  type JsxChild,
} from "typescript";
import {
  type EvidenceState,
  getAccessibleTextState,
  getJsxTagName,
  getLineNumber,
  getTextAttributeState,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { advisory, fail, pass } from "./rule-result";

const LINK_TAGS = new Set(["Link", "a"]);

const getChildNameState = (child: JsxChild): EvidenceState => {
  if (isJsxSelfClosingElement(child)) {
    const tagName = getJsxTagName(child);

    return tagName === "Image" || tagName === "img"
      ? getTextAttributeState(child, "alt")
      : "invalid";
  }

  if (isJsxElement(child)) {
    const ariaLabelState = getTextAttributeState(
      child.openingElement,
      "aria-label"
    );

    if (ariaLabelState === "valid") {
      return "valid";
    }

    const textState = getAccessibleTextState(child.children);

    if (textState === "valid") {
      return "valid";
    }

    return ariaLabelState === "unknown" || textState === "unknown"
      ? "unknown"
      : "invalid";
  }

  return getAccessibleTextState([child]);
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
    let uncertainResult: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ file, node }) => {
      if (failure || !(isJsxElement(node) || isJsxSelfClosingElement(node))) {
        return;
      }

      const openingElement = isJsxElement(node) ? node.openingElement : node;
      const tagName = getJsxTagName(openingElement);

      if (!(tagName && LINK_TAGS.has(tagName))) {
        return;
      }

      const states = [
        getTextAttributeState(openingElement, "aria-label"),
        getTextAttributeState(openingElement, "aria-labelledby"),
        getTextAttributeState(openingElement, "title"),
        ...(isJsxElement(node)
          ? node.children.map((child) => getChildNameState(child))
          : []),
      ];

      if (states.includes("valid")) {
        return;
      }

      if (states.includes("unknown")) {
        uncertainResult ??= advisory(
          "Link uses a dynamic accessible name that cannot be verified statically.",
          "Ensure the dynamic content always resolves to meaningful link text.",
          file.filePath,
          getLineNumber(file, openingElement)
        );
        return;
      }

      failure = fail(
        "Link has no accessible name.",
        "Add meaningful text, an aria-label/aria-labelledby value, or labeled image content.",
        { filePath: file.filePath, line: getLineNumber(file, openingElement) }
      );
    });

    return failure ?? uncertainResult ?? pass("No unnamed links were found.");
  },
  severity: "error",
  title: "links have accessible names",
};

export { linksHaveAccessibleNamesRule };
