import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import {
  getProjectSourceFiles,
  getProjectStyleFiles,
  getTextLineNumber,
  type SourceFile,
} from "./source-files";

const ANIMATION_PATTERN =
  /\banimate-[\w-]+|\btransition(?:-[\w-]+)?\b|animation\s*:|@keyframes\b|<motion\.|\bmotion\.[a-z]/i;
const REDUCED_MOTION_PATTERN =
  /motion-(?:reduce|safe):|prefers-reduced-motion|useReducedMotion\s*\(|<MotionConfig\b|reducedMotion\s*=/i;
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;

const getMotionFiles = async (
  project: Parameters<AuditRule["run"]>[0]["project"]
): Promise<SourceFile[]> => {
  const sourceFiles = await getProjectSourceFiles(project);
  const styleFiles = await getProjectStyleFiles(project);

  return [...sourceFiles, ...styleFiles].filter(
    (file) => !GENERATED_UI_PATH_PATTERN.test(file.path)
  );
};

const animationsRespectReducedMotionRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "low",
  description:
    "Looks for a reduced-motion strategy when application animations or transitions are present.",
  id: "animations-respect-reduced-motion",
  maxScore: 0,
  run: async ({ project }) => {
    const files = await getMotionFiles(project);
    const animatedFile = files.find((file) =>
      ANIMATION_PATTERN.test(file.content)
    );

    if (!animatedFile) {
      return notApplicable("No app-level animation or transition was found.");
    }

    const reducedMotionFile = files.find((file) =>
      REDUCED_MOTION_PATTERN.test(file.content)
    );

    if (reducedMotionFile) {
      return pass(
        "Reduced-motion handling is present alongside animated UI.",
        reducedMotionFile.path,
        getTextLineNumber(reducedMotionFile.content, REDUCED_MOTION_PATTERN)
      );
    }

    return fail(
      "Animated UI was found without reduced-motion source evidence.",
      "Disable or simplify nonessential motion with prefers-reduced-motion, motion-reduce utilities, or the animation library's reduced-motion API.",
      {
        filePath: animatedFile.path,
        line: getTextLineNumber(animatedFile.content, ANIMATION_PATTERN),
      }
    );
  },
  severity: "warning",
  title: "animations respect reduced-motion preferences",
};

export { animationsRespectReducedMotionRule };
