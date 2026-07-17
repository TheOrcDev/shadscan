import { isJsxElement, isJsxSelfClosingElement } from "typescript";
import {
  ancestorHasTagName,
  getJsxAttribute,
  getJsxTagName,
  getLineNumber,
  hasAccessibleText,
  hasJsxAttribute,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, pass } from "./rule-result";

const CUSTOM_CONTROL_TAGS = new Set([
  "Checkbox",
  "Combobox",
  "InputOTP",
  "RadioGroup",
  "SelectTrigger",
  "Slider",
  "Switch",
]);
const LABEL_TAGS = new Set(["FieldLabel", "Label", "label"]);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const customControlsHaveLabelsRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description: "Checks common shadcn custom controls for accessible names.",
  id: "custom-controls-have-labels",
  maxScore: 4,
  run: async ({ project }) => {
    const files = (await parseProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.filePath)
    );
    let failure: AuditRuleResult | null = null;

    for (const file of files) {
      const labelTargets = new Set<string>();

      visitJsxNodes([file], ({ node }) => {
        if (isJsxElement(node)) {
          return;
        }

        const tagName = getJsxTagName(node);

        if (!(tagName && LABEL_TAGS.has(tagName))) {
          return;
        }

        const htmlFor = getJsxAttribute(node, "htmlFor");

        if (typeof htmlFor === "string") {
          labelTargets.add(htmlFor);
        }
      });

      visitJsxNodes([file], ({ ancestors, node }) => {
        if (failure || !(isJsxElement(node) || isJsxSelfClosingElement(node))) {
          return;
        }

        const openingElement = isJsxElement(node) ? node.openingElement : node;
        const tagName = getJsxTagName(openingElement);

        if (!(tagName && CUSTOM_CONTROL_TAGS.has(tagName))) {
          return;
        }

        const id = getJsxAttribute(openingElement, "id");
        const isLabeledById = typeof id === "string" && labelTargets.has(id);
        const isWrappedByLabel =
          ancestorHasTagName(ancestors, "label") ||
          ancestorHasTagName(ancestors, "Label") ||
          ancestorHasTagName(ancestors, "FieldLabel");
        const hasVisibleName =
          isJsxElement(node) && hasAccessibleText(node.children);

        if (
          isLabeledById ||
          isWrappedByLabel ||
          hasVisibleName ||
          hasJsxAttribute(openingElement, "aria-label") ||
          hasJsxAttribute(openingElement, "aria-labelledby") ||
          hasJsxAttribute(openingElement, "title")
        ) {
          return;
        }

        failure = fail(
          `${tagName} has no accessible label.`,
          "Associate the control with Label/FieldLabel, add visible text, or provide aria-label/aria-labelledby.",
          {
            filePath: file.filePath,
            line: getLineNumber(file, openingElement),
          }
        );
      });

      if (failure) {
        return failure;
      }
    }

    return pass("No unlabeled custom controls were found.");
  },
  severity: "error",
  title: "custom controls have accessible labels",
};

export { customControlsHaveLabelsRule };
