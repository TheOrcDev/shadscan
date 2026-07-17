import {
  isIdentifier,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxFragment,
  isJsxSelfClosingElement,
  isJsxText,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isStringLiteral,
  type JsxAttribute,
  type JsxOpeningLikeElement,
  SyntaxKind,
} from "typescript";
import {
  type EvidenceState,
  getJsxTagName,
  getLineNumber,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { advisory, fail, notApplicable, pass } from "./rule-result";

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

const getFallbackState = (attribute: JsxAttribute): EvidenceState => {
  const initializer = attribute.initializer;

  if (!initializer) {
    return "invalid";
  }

  if (isStringLiteral(initializer)) {
    return initializer.text.trim().length > 0 ? "valid" : "invalid";
  }

  if (!(isJsxExpression(initializer) && initializer.expression)) {
    return "invalid";
  }

  const expression = initializer.expression;

  if (
    expression.kind === SyntaxKind.FalseKeyword ||
    expression.kind === SyntaxKind.NullKeyword ||
    expression.kind === SyntaxKind.TrueKeyword ||
    isNumericLiteral(expression)
  ) {
    return "invalid";
  }

  if (isIdentifier(expression) && expression.text === "undefined") {
    return "invalid";
  }

  if (
    isStringLiteral(expression) ||
    isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text.trim().length > 0 ? "valid" : "invalid";
  }

  if (isJsxFragment(expression)) {
    return fragmentHasContent(expression) ? "valid" : "invalid";
  }

  if (isJsxElement(expression) || isJsxSelfClosingElement(expression)) {
    return "valid";
  }

  return "unknown";
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
    let uncertainResult: AuditRuleResult | null = null;

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
      const fallbackState = fallbackAttribute
        ? getFallbackState(fallbackAttribute)
        : "invalid";

      if (fallbackState === "valid") {
        return;
      }

      if (fallbackState === "unknown") {
        uncertainResult ??= advisory(
          "Suspense boundary uses a dynamic fallback that cannot be verified statically.",
          "Ensure the fallback always resolves to visible loading UI.",
          file.filePath,
          getLineNumber(file, openingElement)
        );
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

    return (
      uncertainResult ??
      pass(`All ${suspenseCount} Suspense fallbacks contain useful UI.`)
    );
  },
  severity: "warning",
  title: "Suspense fallbacks are useful",
};

export { suspenseFallbackUsefulRule };
