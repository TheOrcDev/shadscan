import {
  createSourceFile,
  forEachChild,
  isJsxAttribute,
  isJsxExpression,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  type JsxOpeningLikeElement,
  type Node,
  ScriptKind,
  ScriptTarget,
} from "typescript";
import { getJsxAttributeValue, getJsxTagName } from "../ast";
import type { AuditRule } from "../audit";
import { fail, pass } from "./rule-result";
import {
  getProjectSourceFiles,
  getProjectStyleFiles,
  type SourceFile,
} from "./source-files";

const FOCUS_REPLACEMENT_PATTERN =
  /focus-visible:(?:ring|outline|border|shadow)|focus:(?:ring|outline|border|shadow)/;
const CSS_RULE_PATTERN = /([^{}]+)\{([^{}]*)\}/g;
const CSS_OUTLINE_REMOVAL_PATTERN = /outline\s*:\s*(?:none|0)\s*;/i;
const CSS_VISIBLE_PROPERTY_PATTERN =
  /^(?:border(?:-color|-style|-width)?|box-shadow|outline)$/i;
const FOCUS_PSEUDO_PATTERN = /:(?:focus-visible|focus-within|focus)\b/;
const ALL_FOCUS_PSEUDOS_PATTERN = /:(?:focus-visible|focus-within|focus)\b/g;
const CLASS_SEPARATOR_PATTERN = /\s+/;
const FOCUSABLE_CUSTOM_TAG_PATTERN =
  /(?:Button|Trigger|Input|Textarea|Select|Checkbox|Radio|Switch|Slider|Item|Link|Tab)(?:Primitive)?$/;
const FOCUS_MANAGED_SURFACE_PATTERN =
  /^(?:AlertDialog|Dialog|Drawer|Sheet)Content$|(?:^|\.)(?:AlertDialog|Dialog|Drawer|Sheet)(?:Primitive)?\.(?:Content|Popup)$/;
const NATIVE_FOCUSABLE_TAGS = new Set([
  "button",
  "input",
  "select",
  "summary",
  "textarea",
]);

interface CssRule {
  body: string;
  index: number;
  selectors: string[];
}

const parseCssRules = (css: string): CssRule[] =>
  [...css.matchAll(CSS_RULE_PATTERN)].map((match) => ({
    body: match[2] ?? "",
    index: match.index,
    selectors: (match[1] ?? "")
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean),
  }));

const getBaseSelector = (selector: string): string =>
  selector.replace(ALL_FOCUS_PSEUDOS_PATTERN, "").replace(/\s+/g, " ").trim();

const hasVisibleFocusStyle = (body: string): boolean =>
  body.split(";").some((declaration) => {
    const separatorIndex = declaration.indexOf(":");

    if (separatorIndex < 0) {
      return false;
    }

    const property = declaration.slice(0, separatorIndex).trim();
    const value = declaration
      .slice(separatorIndex + 1)
      .trim()
      .toLowerCase();

    return (
      CSS_VISIBLE_PROPERTY_PATTERN.test(property) &&
      value !== "" &&
      value !== "0" &&
      value !== "none"
    );
  });

const hasMatchingFocusReplacement = (
  removalSelector: string,
  rules: CssRule[]
): boolean => {
  const baseSelector = getBaseSelector(removalSelector);

  return rules.some(
    (rule) =>
      hasVisibleFocusStyle(rule.body) &&
      rule.selectors.some(
        (selector) =>
          FOCUS_PSEUDO_PATTERN.test(selector) &&
          getBaseSelector(selector) === baseSelector
      )
  );
};

const collectStaticStrings = (node: Node, values: string[]): void => {
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
    values.push(node.text);
    return;
  }

  forEachChild(node, (child) => collectStaticStrings(child, values));
};

const getStaticClassValue = (node: JsxOpeningLikeElement): string => {
  for (const property of node.attributes.properties) {
    if (
      !(
        isJsxAttribute(property) &&
        ["class", "className"].includes(property.name.getText()) &&
        property.initializer
      )
    ) {
      continue;
    }

    if (isStringLiteral(property.initializer)) {
      return property.initializer.text;
    }

    if (
      isJsxExpression(property.initializer) &&
      property.initializer.expression
    ) {
      const values: string[] = [];
      collectStaticStrings(property.initializer.expression, values);
      return values.join(" ");
    }
  }

  return "";
};

const suppressesOwnOutline = (classValue: string): boolean =>
  classValue.split(CLASS_SEPARATOR_PATTERN).some((className) => {
    if (className === "outline-none") {
      return true;
    }

    return !className.includes("[") && className.endsWith(":outline-none");
  });

const isPotentialFocusTarget = (node: JsxOpeningLikeElement): boolean => {
  const tagName = getJsxTagName(node);

  if (!tagName) {
    return false;
  }

  if (NATIVE_FOCUSABLE_TAGS.has(tagName)) {
    return true;
  }

  if (tagName === "a" && getJsxAttributeValue(node, "href").kind !== "absent") {
    return true;
  }

  if (
    FOCUSABLE_CUSTOM_TAG_PATTERN.test(tagName) ||
    FOCUS_MANAGED_SURFACE_PATTERN.test(tagName)
  ) {
    return true;
  }

  const tabIndex = getJsxAttributeValue(node, "tabIndex");
  if (
    tabIndex.kind === "static" &&
    typeof tabIndex.value === "number" &&
    tabIndex.value >= 0
  ) {
    return true;
  }

  const contentEditable = getJsxAttributeValue(node, "contentEditable");
  return contentEditable.kind === "static" && contentEditable.value === true;
};

const findSourceOutlineSuppression = (file: SourceFile): number | null => {
  const sourceFile = createSourceFile(
    file.path,
    file.content,
    ScriptTarget.Latest,
    true,
    ScriptKind.TSX
  );
  let suppressionLine: number | null = null;

  const visit = (node: Node): void => {
    if (suppressionLine !== null) {
      return;
    }

    if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
      const classValue = getStaticClassValue(node);

      if (
        isPotentialFocusTarget(node) &&
        suppressesOwnOutline(classValue) &&
        !FOCUS_REPLACEMENT_PATTERN.test(classValue)
      ) {
        suppressionLine =
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1;
        return;
      }
    }

    forEachChild(node, visit);
  };

  visit(sourceFile);
  return suppressionLine;
};

const focusVisibleNotSuppressedRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "medium",
  description:
    "Checks explicit focus-outline removal for a visible replacement style.",
  id: "focus-visible-not-suppressed",
  maxScore: 3,
  run: async ({ project }) => {
    const sourceFiles = await getProjectSourceFiles(project);

    for (const file of sourceFiles) {
      const line = findSourceOutlineSuppression(file);

      if (line !== null) {
        return fail(
          "A focus target removes its outline without a visible replacement.",
          "Add a focus-visible ring, outline, border, or shadow before suppressing the default outline.",
          { filePath: file.path, line }
        );
      }
    }

    const styleFiles = await getProjectStyleFiles(project);

    for (const file of styleFiles) {
      const rules = parseCssRules(file.content);

      for (const rule of rules) {
        if (!CSS_OUTLINE_REMOVAL_PATTERN.test(rule.body)) {
          continue;
        }

        const selectorsWithoutReplacement = rule.selectors.filter(
          (selector) =>
            !(
              hasVisibleFocusStyle(rule.body) ||
              hasMatchingFocusReplacement(selector, rules)
            )
        );

        if (selectorsWithoutReplacement.length > 0) {
          return fail(
            `CSS removes focus outlines from ${selectorsWithoutReplacement.join(", ")} without a matching visible replacement.`,
            "Provide a visible focus-visible style for the same selector before removing user-agent outlines.",
            {
              filePath: file.path,
              line: file.content.slice(0, rule.index).split("\n").length,
            }
          );
        }
      }
    }

    return pass("No uncorrected focus-outline suppression was found.");
  },
  severity: "error",
  title: "focus indicators are not suppressed",
};

export { focusVisibleNotSuppressedRule };
