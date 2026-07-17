import { readFile } from "node:fs/promises";
import type { AuditRule } from "../audit";
import { fail, pass } from "./rule-result";
import { findFiles, getProjectSourceFiles } from "./source-files";

const CLASS_VALUE_PATTERN =
  /className\s*=\s*(?:["'`]([^"'`]*outline-none[^"'`]*)["'`]|\{[^}]*["'`]([^"'`]*outline-none[^"'`]*)["'`][^}]*\})/g;
const FOCUS_REPLACEMENT_PATTERN =
  /focus-visible:(?:ring|outline|border|shadow)|focus:(?:ring|outline|border|shadow)/;
const CSS_OUTLINE_REMOVAL_PATTERN = /outline\s*:\s*(?:none|0)\s*;/i;
const CSS_FOCUS_REPLACEMENT_PATTERN =
  /:focus-visible[^{]*\{[^}]*(?:outline|box-shadow|border)/i;

const focusVisibleNotSuppressedRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "medium",
  description:
    "Checks explicit focus-outline removal for a visible replacement style.",
  id: "focus-visible-not-suppressed",
  maxScore: 3,
  run: async ({ project }) => {
    const sourceFiles = await getProjectSourceFiles(project);

    for (const file of sourceFiles) {
      CLASS_VALUE_PATTERN.lastIndex = 0;

      for (const match of file.content.matchAll(CLASS_VALUE_PATTERN)) {
        const classValue = match[1] ?? match[2] ?? "";

        if (!FOCUS_REPLACEMENT_PATTERN.test(classValue)) {
          const line = file.content.slice(0, match.index).split("\n").length;
          return fail(
            "A control removes its focus outline without a visible replacement.",
            "Add a focus-visible ring, outline, border, or shadow before suppressing the default outline.",
            { filePath: file.path, line }
          );
        }
      }
    }

    const cssPaths = await findFiles(project.rootDir, [
      "app/**/*.css",
      "src/**/*.css",
      "styles/**/*.css",
    ]);

    for (const cssPath of cssPaths) {
      const css = await readFile(cssPath, "utf8");

      if (
        CSS_OUTLINE_REMOVAL_PATTERN.test(css) &&
        !CSS_FOCUS_REPLACEMENT_PATTERN.test(css)
      ) {
        return fail(
          "CSS removes focus outlines without a :focus-visible replacement.",
          "Provide a visible :focus-visible style before removing user-agent outlines.",
          { filePath: cssPath }
        );
      }
    }

    return pass("No uncorrected focus-outline suppression was found.");
  },
  severity: "error",
  title: "focus indicators are not suppressed",
};

export { focusVisibleNotSuppressedRule };
