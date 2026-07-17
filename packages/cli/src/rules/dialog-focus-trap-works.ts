import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const DIALOG_PATTERN =
  /<(?:AlertDialog|Dialog|Drawer|Sheet)(?:Content|Root)?\b|role\s*=\s*["'](?:alertdialog|dialog)["']/i;
const FOCUS_MANAGED_DIALOG_PATTERN =
  /from\s+["'][^"']*(?:components\/ui\/(?:alert-dialog|dialog|drawer|sheet)|@radix-ui\/react-dialog|@headlessui\/react|react-aria-components|@base-ui\/react|vaul)[^"']*["']/i;
const FOCUS_MANAGED_DEPENDENCIES = [
  "@base-ui/react",
  "@headlessui/react",
  "@radix-ui/react-dialog",
  "react-aria-components",
  "vaul",
];
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const dialogFocusTrapWorksRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "low",
  description:
    "Looks for focus-managed primitives behind dialog-like user interfaces.",
  id: "dialog-focus-trap-works",
  maxScore: 1,
  run: async ({ project }) => {
    const files = (await getProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.path)
    );
    const dialogFile = files.find((file) => DIALOG_PATTERN.test(file.content));

    if (!dialogFile) {
      return notApplicable("No app-level dialog surface was found.");
    }

    const primitiveFile = files.find((file) =>
      FOCUS_MANAGED_DIALOG_PATTERN.test(file.content)
    );
    const primitiveDependency = FOCUS_MANAGED_DEPENDENCIES.find(
      (dependency) => project.dependencies[dependency]
    );

    if (primitiveFile || primitiveDependency) {
      return pass(
        "A focus-managed dialog primitive is present; runtime focus behavior still needs browser verification.",
        primitiveFile?.path ?? dialogFile.path,
        primitiveFile
          ? getTextLineNumber(
              primitiveFile.content,
              FOCUS_MANAGED_DIALOG_PATTERN
            )
          : getTextLineNumber(dialogFile.content, DIALOG_PATTERN)
      );
    }

    return fail(
      "A custom dialog surface was found without focus-management primitive evidence.",
      "Use a proven dialog primitive, then verify initial focus, Tab containment, Escape behavior, and focus return in a browser.",
      {
        filePath: dialogFile.path,
        line: getTextLineNumber(dialogFile.content, DIALOG_PATTERN),
      }
    );
  },
  severity: "warning",
  title: "dialogs trap and restore focus correctly",
};

export { dialogFocusTrapWorksRule };
