import { isJsxElement } from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  hasJsxAttribute,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule } from "../audit";
import { fail, pass } from "./rule-result";

interface NavigationLandmark {
  file: ParsedSourceFile;
  line: number;
  named: boolean;
}

const NAVIGATION_TAGS = new Set(["NavigationMenu", "nav"]);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const navLandmarksHaveNamesRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description:
    "Checks multiple navigation landmarks for distinguishing accessible names.",
  id: "nav-landmarks-have-names",
  maxScore: 2,
  run: async ({ project }) => {
    const files = (await parseProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.filePath)
    );
    const landmarks: NavigationLandmark[] = [];

    visitJsxNodes(files, ({ file, node }) => {
      if (isJsxElement(node)) {
        return;
      }

      const tagName = getJsxTagName(node);

      if (!(tagName && NAVIGATION_TAGS.has(tagName))) {
        return;
      }

      landmarks.push({
        file,
        line: getLineNumber(file, node),
        named:
          hasJsxAttribute(node, "aria-label") ||
          hasJsxAttribute(node, "aria-labelledby"),
      });
    });

    if (landmarks.length <= 1) {
      return pass("The app has at most one unnamed navigation landmark.");
    }

    const unnamedLandmark = landmarks.find((landmark) => !landmark.named);

    if (unnamedLandmark) {
      return fail(
        "Multiple navigation landmarks exist and at least one has no accessible name.",
        "Give each nav or NavigationMenu a distinct aria-label or aria-labelledby value.",
        {
          filePath: unnamedLandmark.file.filePath,
          line: unnamedLandmark.line,
        }
      );
    }

    return pass(`All ${landmarks.length} navigation landmarks are named.`);
  },
  severity: "warning",
  title: "multiple navigation landmarks are named",
};

export { navLandmarksHaveNamesRule };
