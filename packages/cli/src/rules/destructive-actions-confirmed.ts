import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const DESTRUCTIVE_ACTION_PATTERN =
  /\b(?:delete|destroy|erase|remove|revoke)\b|variant\s*=\s*["']destructive["']/i;
const CONFIRMATION_OR_UNDO_PATTERN =
  /\b(?:AlertDialog|ConfirmDialog|ConfirmationDialog|Undo)\b|(?:window\.)?confirm\s*\(/i;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const destructiveActionsConfirmedRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "low",
  description:
    "Looks for confirmation or undo affordances around destructive actions.",
  id: "destructive-actions-confirmed",
  maxScore: 1,
  run: async ({ project }) => {
    const files = (await getProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.path)
    );
    const destructiveFile = files.find((file) =>
      DESTRUCTIVE_ACTION_PATTERN.test(file.content)
    );

    if (!destructiveFile) {
      return notApplicable("No destructive app-level action was found.");
    }

    const safeguardFile = files.find((file) =>
      CONFIRMATION_OR_UNDO_PATTERN.test(file.content)
    );

    if (safeguardFile) {
      return pass(
        "Confirmation or undo evidence accompanies destructive actions.",
        safeguardFile.path,
        getTextLineNumber(safeguardFile.content, CONFIRMATION_OR_UNDO_PATTERN)
      );
    }

    return fail(
      "A destructive action was found without confirmation or undo evidence.",
      "Add a focused confirmation dialog or a reliable undo path, then exercise the complete destructive flow in a browser.",
      {
        filePath: destructiveFile.path,
        line: getTextLineNumber(
          destructiveFile.content,
          DESTRUCTIVE_ACTION_PATTERN
        ),
      }
    );
  },
  severity: "warning",
  title: "destructive actions are confirmed or reversible",
};

export { destructiveActionsConfirmedRule };
