import {
  isIdentifier,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxFragment,
  isJsxSelfClosingElement,
  isJsxText,
  isStringLiteral,
  type JsxAttribute,
  type JsxOpeningLikeElement,
  SyntaxKind,
} from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const getOpeningElement = (
  node:
    | import("typescript").JsxElement
    | import("typescript").JsxOpeningLikeElement
): JsxOpeningLikeElement => (isJsxElement(node) ? node.openingElement : node);

const getFallbackAttribute = (
  node: JsxOpeningLikeElement
): JsxAttribute | null => {
  for (const property of node.attributes.properties) {
    if (isJsxAttribute(property) && property.name.getText() === "fallback") {
      return property;
    }
  }

  return null;
};

const fragmentHasContent = (
  fragment: import("typescript").JsxFragment
): boolean =>
  fragment.children.some((child) => {
    if (isJsxText(child)) {
      return child.getText().trim().length > 0;
    }

    return isJsxElement(child) || isJsxSelfClosingElement(child);
  });

const hasUsefulFallback = (attribute: JsxAttribute): boolean => {
  const initializer = attribute.initializer;

  if (!initializer) {
    return false;
  }

  if (isStringLiteral(initializer)) {
    return initializer.text.trim().length > 0;
  }

  if (!(isJsxExpression(initializer) && initializer.expression)) {
    return false;
  }

  const expression = initializer.expression;

  if (expression.kind === SyntaxKind.NullKeyword) {
    return false;
  }

  if (isIdentifier(expression) && expression.text === "undefined") {
    return false;
  }

  if (isJsxFragment(expression)) {
    return fragmentHasContent(expression);
  }

  return true;
};

const suspenseFallbackUsefulRule: AuditRule = {
  adapters: ["core"],
  category: "states",
  confidence: "high",
  description: "Checks every Suspense boundary for a non-empty fallback.",
  id: "suspense-fallback-useful",
  maxScore: 3,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    let suspenseCount = 0;
    let failure: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ file, node }) => {
      if (failure || !isJsxElement(node)) {
        return;
      }

      const openingElement = getOpeningElement(node);

      if (getJsxTagName(openingElement) !== "Suspense") {
        return;
      }

      suspenseCount += 1;
      const fallbackAttribute = getFallbackAttribute(openingElement);

      if (fallbackAttribute && hasUsefulFallback(fallbackAttribute)) {
        return;
      }

      failure = fail(
        "Suspense boundary has no useful fallback.",
        "Render a visible skeleton, spinner, or lightweight loading state from the fallback prop.",
        {
          filePath: file.filePath,
          line: getLineNumber(file, openingElement),
        }
      );
    });

    if (failure) {
      return failure;
    }

    if (suspenseCount === 0) {
      return notApplicable("No Suspense boundaries were found.");
    }

    return pass(`All ${suspenseCount} Suspense fallbacks contain useful UI.`);
  },
  severity: "warning",
  title: "Suspense fallbacks are useful",
};

export { suspenseFallbackUsefulRule };
