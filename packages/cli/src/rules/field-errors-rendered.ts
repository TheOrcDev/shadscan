import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const CUSTOM_VALIDATION_PATTERN =
  /\b(?:formState\.errors|fieldState\.error|errors\.\w+|safeParse|zodResolver|yupResolver|valibotResolver|useActionState|useForm\s*\()/;
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
    const files = await getProjectSourceFiles(project);
    const validationFile = files.find((file) =>
      CUSTOM_VALIDATION_PATTERN.test(file.content)
    );

    if (!validationFile) {
      return notApplicable("No custom form-validation state was found.");
    }

    const errorUiFile = files.find((file) =>
      RENDERED_ERROR_PATTERN.test(file.content)
    );

    if (errorUiFile) {
      return pass(
        "Custom validation errors are rendered in the form UI.",
        errorUiFile.path,
        getTextLineNumber(errorUiFile.content, RENDERED_ERROR_PATTERN)
      );
    }

    return fail(
      "Custom validation state exists, but no rendered field-error UI was found.",
      "Render field errors with FieldError/FormMessage, an explicit error branch, or another visible error component.",
      {
        filePath: validationFile.path,
        line: getTextLineNumber(
          validationFile.content,
          CUSTOM_VALIDATION_PATTERN
        ),
      }
    );
  },
  severity: "error",
  title: "field validation errors are rendered",
};

export { fieldErrorsRenderedRule };
