import { findOwnedSourceScopes } from "../ast";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

const CUSTOM_VALIDATION_PATTERN =
  /\b(?:formState\.errors|fieldState\.error|errors\.\w+|zodResolver|yupResolver|valibotResolver|useActionState|useForm\s*\()/;
const RENDERED_ERROR_PATTERN =
  /<(?:FieldError|FormMessage|ErrorMessage)(?:\s|>)|role\s*=\s*["']alert["']|(?:formState\.errors|fieldState\.error|errors\.\w+)\s*(?:&&|\?)/;

const fieldErrorsRenderedRule: AuditRule = {
  adapters: ["core"],
  category: "forms",
  confidence: "medium",
  description: "Checks custom form-validation state for rendered field errors.",
  id: "field-errors-rendered",
  maxScore: 3,
  run: async ({ project }) => {
    const validationScopes = await findOwnedSourceScopes(
      project,
      CUSTOM_VALIDATION_PATTERN
    );

    if (validationScopes.length === 0) {
      return notApplicable("No custom form-validation state was found.");
    }

    for (const scope of validationScopes) {
      if (RENDERED_ERROR_PATTERN.test(scope.content)) {
        continue;
      }

      return fail(
        "Custom validation state exists, but its form surface renders no field-error UI.",
        "Render field errors with FieldError/FormMessage, an explicit error branch, or another visible error component.",
        {
          filePath: scope.file.filePath,
          line: scope.line,
        }
      );
    }

    const firstScope = validationScopes[0];
    return pass(
      "Custom validation errors are rendered in their form UI.",
      firstScope?.file.filePath,
      firstScope?.line
    );
  },
  severity: "error",
  title: "field validation errors are rendered",
};

export { fieldErrorsRenderedRule };
