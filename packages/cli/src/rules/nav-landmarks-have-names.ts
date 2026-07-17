import { isJsxElement } from "typescript";
import {
  type EvidenceState,
  getJsxTagName,
  getLineNumber,
  getTextAttributeState,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule } from "../audit";
import { advisory, fail, pass } from "./rule-result";

interface NavigationLandmark {
  file: ParsedSourceFile;
  line: number;
  nameState: EvidenceState;
}

const NAVIGATION_TAGS = new Set(["NavigationMenu", "nav"]);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const getNavigationNameState = (
  node: import("typescript").JsxOpeningLikeElement
): EvidenceState => {
  const states = [
    getTextAttributeState(node, "aria-label"),
    getTextAttributeState(node, "aria-labelledby"),
  ];

  if (states.includes("valid")) {
    return "valid";
  }

  return states.includes("unknown") ? "unknown" : "invalid";
};

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
        nameState: getNavigationNameState(node),
      });
    });

    if (landmarks.length <= 1) {
      return pass("The app has at most one unnamed navigation landmark.");
    }

    const unnamedLandmark = landmarks.find(
      (landmark) => landmark.nameState === "invalid"
    );

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

    const uncertainLandmark = landmarks.find(
      (landmark) => landmark.nameState === "unknown"
    );

    if (uncertainLandmark) {
      return advisory(
        "A navigation landmark uses a dynamic name that cannot be verified statically.",
        "Ensure every navigation label resolves to distinct, meaningful text.",
        uncertainLandmark.file.filePath,
        uncertainLandmark.line
      );
    }

    return pass(`All ${landmarks.length} navigation landmarks are named.`);
  },
  severity: "warning",
  title: "multiple navigation landmarks are named",
};

export { navLandmarksHaveNamesRule };
