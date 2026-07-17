import { isJsxElement } from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  hasJsxAttribute,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const FORM_CONTROL_TAGS = new Set([
  "Input",
  "SelectTrigger",
  "Textarea",
  "input",
  "select",
  "textarea",
]);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const invalidFieldsAssociatedWithErrorsRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "high",
  description:
    "Checks aria-invalid form controls for an associated error description.",
  id: "invalid-fields-associated-with-errors",
  maxScore: 2,
  run: async ({ project }) => {
    const files = (await parseProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.filePath)
    );
    let invalidControlCount = 0;
    let failure: AuditRuleResult | null = null;

    visitJsxNodes(files, ({ file, node }) => {
      if (failure || isJsxElement(node)) {
        return;
      }

      const tagName = getJsxTagName(node);

      if (
        !(
          tagName &&
          FORM_CONTROL_TAGS.has(tagName) &&
          hasJsxAttribute(node, "aria-invalid")
        )
      ) {
        return;
      }

      invalidControlCount += 1;

      if (
        hasJsxAttribute(node, "aria-describedby") ||
        hasJsxAttribute(node, "aria-errormessage")
      ) {
        return;
      }

      failure = fail(
        `${tagName} exposes aria-invalid without an associated error message.`,
        "Reference the field's help/error element with aria-describedby or aria-errormessage.",
        { filePath: file.filePath, line: getLineNumber(file, node) }
      );
    });

    if (failure) {
      return failure;
    }

    if (invalidControlCount === 0) {
      return notApplicable("No controls using aria-invalid were found.");
    }

    return pass(
      `All ${invalidControlCount} aria-invalid controls reference error content.`
    );
  },
  severity: "error",
  title: "invalid fields reference their errors",
};

export { invalidFieldsAssociatedWithErrorsRule };
