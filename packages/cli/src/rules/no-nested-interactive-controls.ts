import { isJsxElement } from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  hasJsxAttribute,
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
      if (failure || !isJsxElement(node)) {
        return;
      }

      const tagName = getJsxTagName(node.openingElement);

      if (!(tagName && INTERACTIVE_TAGS.has(tagName))) {
        return;
      }

      const interactiveAncestor = ancestors.find((ancestor) => {
        if (!isJsxElement(ancestor)) {
          return false;
        }

        const ancestorTag = getJsxTagName(ancestor.openingElement);
        return (
          Boolean(ancestorTag && INTERACTIVE_TAGS.has(ancestorTag)) &&
          !hasJsxAttribute(ancestor.openingElement, "asChild")
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
          line: getLineNumber(file, node.openingElement),
        }
      );
    });

    return failure ?? pass("No nested interactive controls were found.");
  },
  severity: "error",
  title: "interactive controls are not nested",
};

export { noNestedInteractiveControlsRule };
