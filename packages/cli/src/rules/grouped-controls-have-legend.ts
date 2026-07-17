import {
  isJsxElement,
  isJsxSelfClosingElement,
  type JsxChild,
} from "typescript";
import {
  ancestorHasTagName,
  getJsxTagName,
  getLineNumber,
  hasJsxAttribute,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const childrenContainTag = (
  children: readonly JsxChild[],
  tagNames: Set<string>
): boolean =>
  children.some((child) => {
    if (isJsxSelfClosingElement(child)) {
      const tagName = getJsxTagName(child);
      return Boolean(tagName && tagNames.has(tagName));
    }

    if (isJsxElement(child)) {
      const tagName = getJsxTagName(child.openingElement);
      return (
        Boolean(tagName && tagNames.has(tagName)) ||
        childrenContainTag(child.children, tagNames)
      );
    }

    return false;
  });

const LEGEND_TAGS = new Set(["FieldLegend", "legend"]);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const groupedControlsHaveLegendRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "high",
  description:
    "Checks native fieldsets and RadioGroup controls for a legend or accessible group name.",
  id: "grouped-controls-have-legend",
  maxScore: 2,
  run: async ({ project }) => {
    const files = (await parseProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.filePath)
    );
    let groupedControlCount = 0;
    let failure: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ ancestors, file, node }) => {
      if (failure || !isJsxElement(node)) {
        return;
      }

      const openingElement = node.openingElement;
      const tagName = getJsxTagName(openingElement);

      if (tagName === "fieldset") {
        groupedControlCount += 1;

        if (
          childrenContainTag(node.children, LEGEND_TAGS) ||
          hasJsxAttribute(openingElement, "aria-label") ||
          hasJsxAttribute(openingElement, "aria-labelledby")
        ) {
          return;
        }

        failure = fail(
          "Fieldset has no legend or accessible group name.",
          "Add a legend, aria-label, or aria-labelledby value describing the grouped controls.",
          {
            filePath: file.filePath,
            line: getLineNumber(file, openingElement),
          }
        );
        return;
      }

      if (tagName !== "RadioGroup") {
        return;
      }

      groupedControlCount += 1;
      const hasGroupName =
        hasJsxAttribute(openingElement, "aria-label") ||
        hasJsxAttribute(openingElement, "aria-labelledby") ||
        (ancestorHasTagName(ancestors, "FieldSet") &&
          file.content.includes("<FieldLegend"));

      if (!hasGroupName) {
        failure = fail(
          "RadioGroup has no legend or accessible group name.",
          "Place it in FieldSet with FieldLegend, or add aria-label/aria-labelledby.",
          {
            filePath: file.filePath,
            line: getLineNumber(file, openingElement),
          }
        );
      }
    });

    if (failure) {
      return failure;
    }

    if (groupedControlCount === 0) {
      return notApplicable("No fieldset or RadioGroup grouping was found.");
    }

    return pass(`All ${groupedControlCount} control groups have names.`);
  },
  severity: "error",
  title: "grouped controls have legends",
};

export { groupedControlsHaveLegendRule };
