import {
  isJsxElement,
  isJsxSelfClosingElement,
  type JsxElement,
  type JsxOpeningLikeElement,
  type Node,
} from "typescript";
import {
  ancestorHasTagName,
  type EvidenceState,
  getAccessibleTextState,
  getJsxAttribute,
  getJsxTagName,
  getLineNumber,
  getTextAttributeState,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { advisory, fail, pass } from "./rule-result";

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

const getControlLabelState = ({
  ancestors,
  labelTargets,
  node,
  openingElement,
}: {
  ancestors: Node[];
  labelTargets: Set<string>;
  node: JsxElement | JsxOpeningLikeElement;
  openingElement: JsxOpeningLikeElement;
}): EvidenceState => {
  const id = getJsxAttribute(openingElement, "id");
  const isLabeledById =
    typeof id === "string" && id.trim().length > 0 && labelTargets.has(id);
  const isWrappedByLabel =
    ancestorHasTagName(ancestors, "label") ||
    ancestorHasTagName(ancestors, "Label") ||
    ancestorHasTagName(ancestors, "FieldLabel");
  const states = [
    isJsxElement(node) ? getAccessibleTextState(node.children) : "invalid",
    getTextAttributeState(openingElement, "aria-label"),
    getTextAttributeState(openingElement, "aria-labelledby"),
    getTextAttributeState(openingElement, "title"),
  ];

  if (isLabeledById || isWrappedByLabel || states.includes("valid")) {
    return "valid";
  }

  return states.includes("unknown") ? "unknown" : "invalid";
};

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
    let uncertainResult: AuditRuleResult | null = null;

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

        if (typeof htmlFor === "string" && htmlFor.trim().length > 0) {
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

        const labelState = getControlLabelState({
          ancestors,
          labelTargets,
          node,
          openingElement,
        });

        if (labelState === "valid") {
          return;
        }

        if (labelState === "unknown") {
          uncertainResult ??= advisory(
            `${tagName} uses a dynamic accessible label that cannot be verified statically.`,
            "Ensure the dynamic label always resolves to meaningful text.",
            file.filePath,
            getLineNumber(file, openingElement)
          );
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

    return uncertainResult ?? pass("No unlabeled custom controls were found.");
  },
  severity: "error",
  title: "custom controls have accessible labels",
};

export { customControlsHaveLabelsRule };
