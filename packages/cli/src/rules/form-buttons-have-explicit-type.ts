import { isJsxElement, isJsxSelfClosingElement } from "typescript";
import {
  ancestorHasTagName,
  getJsxAttribute,
  getJsxTagName,
  getLineNumber,
  hasJsxAttribute,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const BUTTON_TAGS = new Set(["Button", "button"]);
const BUTTON_TYPES = new Set(["button", "reset", "submit"]);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const formButtonsHaveExplicitTypeRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "high",
  description: "Checks buttons inside forms for an explicit valid type.",
  id: "form-buttons-have-explicit-type",
  maxScore: 2,
  run: async ({ project }) => {
    const files = (await parseProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.filePath)
    );
    let formButtonCount = 0;
    let failure: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ ancestors, file, node }) => {
      if (failure || !(isJsxElement(node) || isJsxSelfClosingElement(node))) {
        return;
      }

      const openingElement = isJsxElement(node) ? node.openingElement : node;
      const tagName = getJsxTagName(openingElement);

      if (
        !(
          tagName &&
          BUTTON_TAGS.has(tagName) &&
          ancestorHasTagName(ancestors, "form")
        ) ||
        hasJsxAttribute(openingElement, "asChild")
      ) {
        return;
      }

      formButtonCount += 1;
      const type = getJsxAttribute(openingElement, "type");

      if (typeof type === "string" && BUTTON_TYPES.has(type)) {
        return;
      }

      failure = fail(
        `${tagName} inside a form has no explicit valid type.`,
        'Set type="submit", type="button", or type="reset" to make its behavior intentional.',
        {
          filePath: file.filePath,
          line: getLineNumber(file, openingElement),
        }
      );
    });

    if (failure) {
      return failure;
    }

    if (formButtonCount === 0) {
      return notApplicable("No buttons inside app-level forms were found.");
    }

    return pass(`All ${formButtonCount} form buttons declare their type.`);
  },
  severity: "warning",
  title: "form buttons have explicit types",
};

export { formButtonsHaveExplicitTypeRule };
