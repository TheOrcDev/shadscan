import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { getProjectSourceFiles, getTextLineNumber } from "./source-files";

const COMPOSITE_WIDGET_PATTERN =
  /<(?:Accordion|Command|Combobox|DropdownMenu|Listbox|Menu|Menubar|NavigationMenu|Select|Tabs|Tree)\b|role\s*=\s*["'](?:grid|listbox|menu|menubar|tablist|tree)["']/i;
const KEYBOARD_PRIMITIVE_PATTERN =
  /from\s+["'][^"']*(?:components\/ui\/(?:accordion|command|dropdown-menu|menubar|navigation-menu|select|tabs)|@radix-ui\/|@headlessui\/react|react-aria-components|@base-ui\/react|ariakit|cmdk|downshift|@zag-js\/)[^"']*["']/i;
const KEYBOARD_PRIMITIVE_DEPENDENCIES = [
  "@base-ui/react",
  "@headlessui/react",
  "ariakit",
  "cmdk",
  "downshift",
  "react-aria-components",
];
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const keyboardNavigationWorksRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "low",
  description:
    "Looks for proven keyboard behavior behind composite widgets such as menus, tabs, and listboxes.",
  id: "keyboard-navigation-works",
  maxScore: 0,
  run: async ({ project }) => {
    const files = (await getProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.path)
    );
    const widgetFile = files.find((file) =>
      COMPOSITE_WIDGET_PATTERN.test(file.content)
    );

    if (!widgetFile) {
      return notApplicable("No composite keyboard widget was found.");
    }

    const primitiveFile = files.find((file) =>
      KEYBOARD_PRIMITIVE_PATTERN.test(file.content)
    );
    const primitiveDependency = Object.keys(project.dependencies).find(
      (dependency) =>
        dependency.startsWith("@radix-ui/react-") ||
        dependency.startsWith("@zag-js/") ||
        KEYBOARD_PRIMITIVE_DEPENDENCIES.includes(dependency)
    );

    if (primitiveFile || primitiveDependency) {
      return pass(
        "A keyboard-aware primitive backs composite widgets; runtime key behavior still needs browser verification.",
        primitiveFile?.path ?? widgetFile.path,
        primitiveFile
          ? getTextLineNumber(primitiveFile.content, KEYBOARD_PRIMITIVE_PATTERN)
          : getTextLineNumber(widgetFile.content, COMPOSITE_WIDGET_PATTERN)
      );
    }

    return fail(
      "A custom composite widget was found without keyboard-aware primitive evidence.",
      "Use a proven accessible primitive or implement and test the widget's expected arrow-key, Home/End, Enter, Escape, and focus behavior.",
      {
        filePath: widgetFile.path,
        line: getTextLineNumber(widgetFile.content, COMPOSITE_WIDGET_PATTERN),
      }
    );
  },
  severity: "warning",
  title: "composite widgets support keyboard navigation",
};

export { keyboardNavigationWorksRule };
