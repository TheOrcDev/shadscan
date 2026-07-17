import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

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
    const files = (await getProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.path)
    );
    const formFile = files.find((file) => FORM_PATTERN.test(file.content));

    if (!formFile) {
      return notApplicable("No app-level form was found.");
    }

    const validationFile = files.find((file) =>
      VALIDATION_PATTERN.test(file.content)
    );

    if (validationFile) {
      return pass(
        "Form validation is wired through native constraints, field rules, or schema parsing.",
        validationFile.path,
        getTextLineNumber(validationFile.content, VALIDATION_PATTERN)
      );
    }

    return fail(
      "Forms were found without wired validation.",
      "Add native constraints, field-level rules, or schema validation connected to submission.",
      {
        filePath: formFile.path,
        line: getTextLineNumber(formFile.content, FORM_PATTERN),
      }
    );
  },
  severity: "warning",
  title: "form validation is wired",
};

export { validationWiredToFormRule };
