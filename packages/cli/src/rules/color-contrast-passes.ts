import type { AuditRule } from "../audit";
import { advisory, notApplicable } from "./rule-result";
import {
  getProjectSourceFiles,
  getProjectStyleFiles,
  getTextLineNumber,
} from "./source-files";

const COLOR_STYLE_PATTERN =
  /(?:color|background(?:-color)?|border-color|fill|stroke)\s*:|\b(?:bg|border|fill|stroke|text)-(?:accent|background|black|card|destructive|foreground|input|muted|popover|primary|ring|secondary|transparent|white|[a-z]+-\d{2,3})\b|#[\da-f]{3,8}\b|(?:hsl|oklch|rgb)a?\s*\(/i;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const colorContrastPassesRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "low",
  description:
    "Marks styled color pairs for computed browser contrast verification.",
  id: "color-contrast-passes",
  maxScore: 0,
  run: async ({ project }) => {
    const sourceFiles = await getProjectSourceFiles(project);
    const styleFiles = await getProjectStyleFiles(project);
    const colorFile = [...sourceFiles, ...styleFiles]
      .filter((file) => !GENERATED_UI_PATH_PATTERN.test(file.path))
      .find((file) => COLOR_STYLE_PATTERN.test(file.content));

    if (!colorFile) {
      return notApplicable("No app-level color styling was found.");
    }

    return advisory(
      "Color styling is present, but computed foreground/background contrast cannot be established statically.",
      "Check rendered states at every theme and viewport: 4.5:1 for normal text, 3:1 for large text, and 3:1 for meaningful UI graphics and boundaries.",
      colorFile.path,
      getTextLineNumber(colorFile.content, COLOR_STYLE_PATTERN)
    );
  },
  severity: "warning",
  title: "rendered color contrast meets accessibility thresholds",
};

export { colorContrastPassesRule };
