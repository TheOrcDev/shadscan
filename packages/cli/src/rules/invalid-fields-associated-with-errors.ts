import { isJsxElement } from "typescript";
import {
  getJsxAttributeValue,
  getJsxTagName,
  getLineNumber,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import { advisory, fail, notApplicable, pass } from "./rule-result";

const FORM_CONTROL_TAGS = new Set([
  "Input",
  "SelectTrigger",
  "Textarea",
  "input",
  "select",
  "textarea",
]);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;
const WHITESPACE_PATTERN = /\s+/;

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
    let uncertainResult: AuditRuleResult | null = null;

    for (const file of files) {
      const elementIds = new Set<string>();

      visitJsxNodes([file], ({ node }) => {
        if (isJsxElement(node)) {
          return;
        }

        const id = getJsxAttributeValue(node, "id");

        if (
          id.kind === "static" &&
          typeof id.value === "string" &&
          id.value.trim().length > 0
        ) {
          elementIds.add(id.value.trim());
        }
      });

      visitJsxNodes([file], ({ node }) => {
        if (failure || isJsxElement(node)) {
          return;
        }

        const tagName = getJsxTagName(node);
        const ariaInvalid = getJsxAttributeValue(node, "aria-invalid");
        const hasInvalidState =
          ariaInvalid.kind === "dynamic" ||
          (ariaInvalid.kind === "static" &&
            ariaInvalid.value !== false &&
            ariaInvalid.value !== null &&
            ariaInvalid.value !== undefined &&
            ariaInvalid.value !== "false");

        if (!(tagName && FORM_CONTROL_TAGS.has(tagName) && hasInvalidState)) {
          return;
        }

        invalidControlCount += 1;
        const descriptionAttributes = [
          getJsxAttributeValue(node, "aria-describedby"),
          getJsxAttributeValue(node, "aria-errormessage"),
        ];
        const staticReferences = descriptionAttributes.flatMap((attribute) =>
          attribute.kind === "static" && typeof attribute.value === "string"
            ? attribute.value.trim().split(WHITESPACE_PATTERN).filter(Boolean)
            : []
        );

        if (
          staticReferences.length > 0 &&
          staticReferences.every((reference) => elementIds.has(reference))
        ) {
          return;
        }

        if (
          descriptionAttributes.some(
            (attribute) => attribute.kind === "dynamic"
          )
        ) {
          uncertainResult ??= advisory(
            `${tagName} uses a dynamic error-message reference that cannot be verified statically.`,
            "Ensure every rendered ID in aria-describedby or aria-errormessage points to error content.",
            file.filePath,
            getLineNumber(file, node)
          );
          return;
        }

        const missingReferences = staticReferences.filter(
          (reference) => !elementIds.has(reference)
        );
        failure = fail(
          missingReferences.length > 0
            ? `${tagName} references missing error content: ${missingReferences.join(", ")}.`
            : `${tagName} exposes aria-invalid without an associated error message.`,
          "Reference an existing help/error element with aria-describedby or aria-errormessage.",
          { filePath: file.filePath, line: getLineNumber(file, node) }
        );
      });

      if (failure) {
        return failure;
      }
    }

    if (invalidControlCount === 0) {
      return notApplicable("No controls using aria-invalid were found.");
    }

    return (
      uncertainResult ??
      pass(
        `All ${invalidControlCount} aria-invalid controls reference existing error content.`
      )
    );
  },
  severity: "error",
  title: "invalid fields reference their errors",
};

export { invalidFieldsAssociatedWithErrorsRule };
