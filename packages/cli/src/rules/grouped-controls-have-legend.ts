import {
  isJsxElement,
  isJsxSelfClosingElement,
  type JsxChild,
  type JsxElement,
  type Node,
} from "typescript";
import {
  type EvidenceState,
  getJsxTagName,
  getLineNumber,
  getTextAttributeState,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { advisory, fail, notApplicable, pass } from "./rule-result";

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

interface GroupEvaluation {
  kind: "Fieldset" | "RadioGroup";
  state: EvidenceState;
}

const getAttributeNameState = (node: JsxElement): EvidenceState => {
  const states = [
    getTextAttributeState(node.openingElement, "aria-label"),
    getTextAttributeState(node.openingElement, "aria-labelledby"),
  ];

  if (states.includes("valid")) {
    return "valid";
  }

  return states.includes("unknown") ? "unknown" : "invalid";
};

const evaluateGroup = (
  node: JsxElement,
  ancestors: Node[]
): GroupEvaluation | null => {
  const tagName = getJsxTagName(node.openingElement);
  const attributeState = getAttributeNameState(node);

  if (tagName === "fieldset") {
    return {
      kind: "Fieldset",
      state: childrenContainTag(node.children, LEGEND_TAGS)
        ? "valid"
        : attributeState,
    };
  }

  if (tagName !== "RadioGroup") {
    return null;
  }

  const fieldSetAncestor = ancestors.find(
    (ancestor) =>
      isJsxElement(ancestor) &&
      getJsxTagName(ancestor.openingElement) === "FieldSet"
  );
  const hasLegend =
    fieldSetAncestor &&
    isJsxElement(fieldSetAncestor) &&
    childrenContainTag(fieldSetAncestor.children, LEGEND_TAGS);

  return {
    kind: "RadioGroup",
    state: hasLegend ? "valid" : attributeState,
  };
};

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
    let uncertainResult: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ ancestors, file, node }) => {
      if (failure || !isJsxElement(node)) {
        return;
      }

      const evaluation = evaluateGroup(node, ancestors);

      if (!evaluation) {
        return;
      }

      groupedControlCount += 1;

      if (evaluation.state === "valid") {
        return;
      }

      if (evaluation.state === "unknown") {
        uncertainResult ??= advisory(
          `${evaluation.kind} uses a dynamic accessible group name that cannot be verified statically.`,
          "Ensure the dynamic label always resolves to meaningful text.",
          file.filePath,
          getLineNumber(file, node.openingElement)
        );
        return;
      }

      const remediation =
        evaluation.kind === "Fieldset"
          ? "Add a legend, aria-label, or aria-labelledby value describing the grouped controls."
          : "Place it in FieldSet with FieldLegend, or add aria-label/aria-labelledby.";
      failure = fail(
        `${evaluation.kind} has no legend or accessible group name.`,
        remediation,
        {
          filePath: file.filePath,
          line: getLineNumber(file, node.openingElement),
        }
      );
    });

    if (failure) {
      return failure;
    }

    if (groupedControlCount === 0) {
      return notApplicable("No fieldset or RadioGroup grouping was found.");
    }

    return (
      uncertainResult ??
      pass(`All ${groupedControlCount} control groups have names.`)
    );
  },
  severity: "error",
  title: "grouped controls have legends",
};

export { groupedControlsHaveLegendRule };
