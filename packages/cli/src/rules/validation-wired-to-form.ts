import { findOwnedSourceScopes } from "../ast";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const FORM_PATTERN = /<form(?:\s|>)/;
const VALIDATION_PATTERN =
  /\b(?:required|minLength|maxLength|pattern)\s*=|type\s*=\s*["'](?:email|url|number)["']|\b(?:zodResolver|yupResolver|valibotResolver|safeParse|parseAsync)\s*\(|\bresolver\s*:|\brules\s*=|register\s*\([^)]*,\s*\{[^}]*(?:required|minLength|maxLength|pattern|validate)/;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const validationWiredToFormRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "medium",
  description:
    "Checks detected forms for native, library, or schema validation.",
  id: "validation-wired-to-form",
  maxScore: 3,
  run: async ({ project }) => {
    const formScopes = (
      await findOwnedSourceScopes(project, FORM_PATTERN)
    ).filter((scope) => !GENERATED_UI_PATH_PATTERN.test(scope.file.filePath));

    if (formScopes.length === 0) {
      return notApplicable("No app-level form was found.");
    }

    for (const scope of formScopes) {
      if (VALIDATION_PATTERN.test(scope.content)) {
        continue;
      }

      return fail(
        "A form was found without wired validation.",
        "Add native constraints, field-level rules, or schema validation connected to submission.",
        {
          filePath: scope.file.filePath,
          line: scope.line,
        }
      );
    }

    const firstScope = formScopes[0];
    return pass(
      "Form validation is wired through native constraints, field rules, or schema parsing.",
      firstScope?.file.filePath,
      firstScope?.line
    );
  },
  severity: "warning",
  title: "form validation is wired",
};

export { validationWiredToFormRule };
