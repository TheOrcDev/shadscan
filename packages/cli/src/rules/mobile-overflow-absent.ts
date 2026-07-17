import type { AuditRule } from "../audit";
import { advisory, notApplicable } from "./rule-result";
import {
  getProjectSourceFiles,
  getProjectStyleFiles,
  getTextLineNumber,
} from "./source-files";

const OVERFLOW_RISK_PATTERN =
  /\bw-screen\b|\bmin-w-(?:screen|\[[^\]]+\])\b|\bw-\[\d{3,}px\]\b|(?:min-)?width\s*:\s*(?:100vw|\d{3,}px)\b|\boverflow-x-visible\b/i;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const mobileOverflowAbsentRule: AuditRule = {
  adapters: ["core"],
  category: "production-polish",
  confidence: "low",
  description:
    "Marks responsive layouts for rendered horizontal-overflow verification.",
  id: "mobile-overflow-absent",
  maxScore: 1,
  run: async ({ project }) => {
    const sourceFiles = await getProjectSourceFiles(project);

    if (sourceFiles.length === 0) {
      return notApplicable("No application UI source files were found.");
    }

    const styleFiles = await getProjectStyleFiles(project);
    const files = [...sourceFiles, ...styleFiles].filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.path)
    );
    const riskyFile = files.find((file) =>
      OVERFLOW_RISK_PATTERN.test(file.content)
    );

    if (riskyFile) {
      return advisory(
        "An overflow-prone fixed or viewport width was found in app-level UI.",
        "Constrain wide content locally, prefer max-width and fluid sizing, and verify that 320px-wide pages do not gain unintended horizontal scrolling.",
        riskyFile.path,
        getTextLineNumber(riskyFile.content, OVERFLOW_RISK_PATTERN)
      );
    }

    return advisory(
      "No obvious static overflow risk was found, but rendered mobile width still requires verification.",
      "Exercise representative routes at 320px and with long content; confirm the document does not scroll horizontally and intentional scrollers remain local.",
      sourceFiles[0]?.path
    );
  },
  severity: "warning",
  title: "mobile pages avoid unintended horizontal overflow",
};

export { mobileOverflowAbsentRule };
