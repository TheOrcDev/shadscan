import { isJsxElement, isJsxSelfClosingElement } from "typescript";
import {
  getJsxAttributeValue,
  getJsxTagName,
  getLineNumber,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, pass } from "./rule-result";

const INTERACTIVE_TAGS = new Set([
  "Button",
  "Link",
  "a",
  "button",
  "input",
  "select",
  "textarea",
]);

const noNestedInteractiveControlsRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description:
    "Checks for interactive controls nested inside other interactive controls.",
  id: "no-nested-interactive-controls",
  maxScore: 3,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    let failure: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ ancestors, file, node }) => {
      if (failure || !(isJsxElement(node) || isJsxSelfClosingElement(node))) {
        return;
      }

      const openingElement = isJsxElement(node) ? node.openingElement : node;
      const tagName = getJsxTagName(openingElement);

      if (!(tagName && INTERACTIVE_TAGS.has(tagName))) {
        return;
      }

      const interactiveAncestor = ancestors.find((ancestor) => {
        if (!isJsxElement(ancestor)) {
          return false;
        }

        const ancestorTag = getJsxTagName(ancestor.openingElement);
        const asChild = getJsxAttributeValue(
          ancestor.openingElement,
          "asChild"
        );
        return (
          Boolean(ancestorTag && INTERACTIVE_TAGS.has(ancestorTag)) &&
          !(asChild.kind === "static" && asChild.value === true)
        );
      });

      if (!(interactiveAncestor && isJsxElement(interactiveAncestor))) {
        return;
      }

      const ancestorTag = getJsxTagName(interactiveAncestor.openingElement);
      failure = fail(
        `${tagName} is nested inside interactive ${ancestorTag}.`,
        "Render one interactive element, or use the component's asChild/slot composition when supported.",
        {
          filePath: file.filePath,
          line: getLineNumber(file, openingElement),
        }
      );
    });

    return failure ?? pass("No nested interactive controls were found.");
  },
  severity: "error",
  title: "interactive controls are not nested",
};

export { noNestedInteractiveControlsRule };
