import {
  isIdentifier,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxSelfClosingElement,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
  type JsxAttribute,
  type JsxOpeningLikeElement,
  type Node,
} from "typescript";
import {
  getLineNumber,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule } from "../audit";
import { advisory, notApplicable } from "./rule-result";
import { getProjectStyleFiles, type SourceFile } from "./source-files";

const CLASS_OVERFLOW_RISK_PATTERN =
  /(?:^|[\s"'`])(?:[\w-]+:)*!?(?:w-screen|min-w-(?:screen|\[[^\]\s]+\])|w-\[\d{3,}px\]|overflow-x-visible)(?=$|[\s"'`])/i;
const CSS_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const CSS_DECLARATION_RISK_PATTERN =
  /(?:^|[;{])\s*((?:min-)?width\s*:\s*(?:100vw|\d{3,}px)\b|overflow-x\s*:\s*visible\b)/im;
const FIXED_WIDTH_VALUE_PATTERN = /\b100vw\b|\b\d{3,}px\b/i;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;
const MIN_RISKY_NUMERIC_WIDTH = 100;
const OVERFLOW_CONTAINMENT_CLASS_PATTERN =
  /(?:^|[\s"'`])!?(?:overflow|overflow-x)-(?:auto|clip|hidden|scroll)(?=$|[\s"'`])/i;
const OVERFLOW_CONTAINMENT_VALUES = new Set([
  "auto",
  "clip",
  "hidden",
  "scroll",
]);

interface OverflowRisk {
  filePath: string;
  line: number;
}

const getJsxAttributeNode = (
  node: JsxOpeningLikeElement,
  name: string
): JsxAttribute | null => {
  for (const property of node.attributes.properties) {
    if (isJsxAttribute(property) && property.name.getText() === name) {
      return property;
    }
  }

  return null;
};

const getClassRiskNode = (node: JsxOpeningLikeElement): Node | null => {
  const classAttribute =
    getJsxAttributeNode(node, "className") ??
    getJsxAttributeNode(node, "class");

  if (
    !(
      classAttribute?.initializer &&
      CLASS_OVERFLOW_RISK_PATTERN.test(classAttribute.initializer.getText())
    )
  ) {
    return null;
  }

  return classAttribute;
};

const getPropertyName = (node: Node): string | null => {
  if (isIdentifier(node) || isStringLiteral(node)) {
    return node.text.replaceAll("-", "").toLowerCase();
  }

  return null;
};

const getStaticStyleValue = (node: Node): number | string | null => {
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  return isNumericLiteral(node) ? Number(node.text) : null;
};

const isRiskyStyleValue = (
  propertyName: string,
  value: number | string
): boolean => {
  if (propertyName === "overflowx") {
    return (
      typeof value === "string" && value.trim().toLowerCase() === "visible"
    );
  }

  if (propertyName !== "width" && propertyName !== "minwidth") {
    return false;
  }

  return typeof value === "number"
    ? value >= MIN_RISKY_NUMERIC_WIDTH
    : FIXED_WIDTH_VALUE_PATTERN.test(value);
};

const getInlineStyleRiskNode = (node: JsxOpeningLikeElement): Node | null => {
  const styleAttribute = getJsxAttributeNode(node, "style");

  if (
    !(
      styleAttribute?.initializer &&
      isJsxExpression(styleAttribute.initializer) &&
      styleAttribute.initializer.expression &&
      isObjectLiteralExpression(styleAttribute.initializer.expression)
    )
  ) {
    return null;
  }

  for (const property of styleAttribute.initializer.expression.properties) {
    if (!isPropertyAssignment(property)) {
      continue;
    }

    const propertyName = getPropertyName(property.name);
    const value = getStaticStyleValue(property.initializer);

    if (
      propertyName &&
      value !== null &&
      isRiskyStyleValue(propertyName, value)
    ) {
      return property;
    }
  }

  return null;
};

const hasInlineOverflowContainment = (node: JsxOpeningLikeElement): boolean => {
  const styleAttribute = getJsxAttributeNode(node, "style");

  if (
    !(
      styleAttribute?.initializer &&
      isJsxExpression(styleAttribute.initializer) &&
      styleAttribute.initializer.expression &&
      isObjectLiteralExpression(styleAttribute.initializer.expression)
    )
  ) {
    return false;
  }

  return styleAttribute.initializer.expression.properties.some((property) => {
    if (!isPropertyAssignment(property)) {
      return false;
    }

    const propertyName = getPropertyName(property.name);
    const value = getStaticStyleValue(property.initializer);

    return (
      (propertyName === "overflow" || propertyName === "overflowx") &&
      typeof value === "string" &&
      OVERFLOW_CONTAINMENT_VALUES.has(value.trim().toLowerCase())
    );
  });
};

const hasOverflowContainment = (ancestors: Node[]): boolean =>
  ancestors.some((ancestor) => {
    if (!isJsxElement(ancestor)) {
      return false;
    }

    const openingElement = ancestor.openingElement;
    const classAttribute =
      getJsxAttributeNode(openingElement, "className") ??
      getJsxAttributeNode(openingElement, "class");
    const hasClassContainment = Boolean(
      classAttribute?.initializer &&
        OVERFLOW_CONTAINMENT_CLASS_PATTERN.test(
          classAttribute.initializer.getText()
        )
    );

    return hasClassContainment || hasInlineOverflowContainment(openingElement);
  });

const findSourceOverflowRisk = (
  files: ParsedSourceFile[]
): OverflowRisk | null => {
  let risk: OverflowRisk | null = null;

  visitJsxNodes(files, ({ ancestors, file, node }) => {
    if (risk || !(isJsxElement(node) || isJsxSelfClosingElement(node))) {
      return;
    }

    const openingElement = isJsxElement(node) ? node.openingElement : node;
    const riskNode =
      getClassRiskNode(openingElement) ??
      getInlineStyleRiskNode(openingElement);

    if (riskNode && !hasOverflowContainment(ancestors)) {
      risk = {
        filePath: file.filePath,
        line: getLineNumber(file, riskNode),
      };
    }
  });

  return risk;
};

const stripCssComments = (content: string): string =>
  content.replace(CSS_COMMENT_PATTERN, (comment) =>
    comment.replace(/[^\n]/g, " ")
  );

const getLineAtIndex = (content: string, index: number): number =>
  content.slice(0, index).split("\n").length;

const findStyleOverflowRisk = (files: SourceFile[]): OverflowRisk | null => {
  for (const file of files) {
    const content = stripCssComments(file.content);
    const match = CSS_DECLARATION_RISK_PATTERN.exec(content);
    const declaration = match?.[1];

    if (!(match && declaration)) {
      continue;
    }

    const declarationOffset = match[0].lastIndexOf(declaration);

    return {
      filePath: file.path,
      line: getLineAtIndex(content, match.index + declarationOffset),
    };
  }

  return null;
};

const mobileOverflowAbsentRule: AuditRule = {
  adapters: ["core"],
  category: "production-polish",
  confidence: "low",
  description:
    "Marks uncontained fixed or viewport widths in layout-bearing contexts for rendered horizontal-overflow verification.",
  id: "mobile-overflow-absent",
  maxScore: 0,
  run: async ({ project }) => {
    const sourceFiles = (await parseProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.filePath)
    );

    if (sourceFiles.length === 0) {
      return notApplicable("No application UI source files were found.");
    }

    const styleFiles = (await getProjectStyleFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.path)
    );
    const risk =
      findSourceOverflowRisk(sourceFiles) ?? findStyleOverflowRisk(styleFiles);

    if (risk) {
      return advisory(
        "An overflow-prone fixed or viewport width was found in app-level UI.",
        "Constrain wide content locally, prefer max-width and fluid sizing, and verify that 320px-wide pages do not gain unintended horizontal scrolling.",
        risk.filePath,
        risk.line
      );
    }

    return advisory(
      "No obvious static overflow risk was found, but rendered mobile width still requires verification.",
      "Exercise representative routes at 320px and with long content; confirm the document does not scroll horizontally and intentional scrollers remain local."
    );
  },
  severity: "warning",
  title: "mobile pages avoid unintended horizontal overflow",
};

export { mobileOverflowAbsentRule };
