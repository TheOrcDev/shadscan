import {
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isJsxElement,
  isMethodDeclaration,
  type JsxOpeningLikeElement,
  type Node,
} from "typescript";
import {
  type EvidenceState,
  getJsxAttributeValue,
  getJsxTagName,
  getLineNumber,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  visitJsxNodes,
} from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import {
  getResponsiveVisibility,
  type ResponsiveVisibility,
  responsiveVisibilitiesOverlap,
} from "./responsive-visibility";
import { advisory, fail, pass } from "./rule-result";

interface NavigationName {
  state: EvidenceState;
  value: string | null;
}

interface NavigationLandmark {
  file: ParsedSourceFile;
  line: number;
  name: NavigationName;
  ownerKey: string;
  visibility: ResponsiveVisibility;
}

const NAVIGATION_TAGS = new Set(["NavigationMenu", "nav"]);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;
const RADIX_DEFAULT_NAVIGATION_NAME = "Main";

const isFunctionOwner = (node: Node): boolean =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node) ||
  isMethodDeclaration(node);

const getOwnerKey = (file: ParsedSourceFile, ancestors: Node[]): string => {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];

    if (ancestor && isFunctionOwner(ancestor)) {
      return `${file.filePath}:${ancestor.getStart(file.sourceFile)}`;
    }
  }

  return `${file.filePath}:file`;
};

const getAttributeName = (
  node: JsxOpeningLikeElement,
  attributeName: "aria-label" | "aria-labelledby"
): NavigationName | null => {
  const attribute = getJsxAttributeValue(node, attributeName);

  if (attribute.kind === "absent") {
    return null;
  }

  if (attribute.kind === "dynamic") {
    return { state: "unknown", value: null };
  }

  if (
    typeof attribute.value === "string" &&
    attribute.value.trim().length > 0
  ) {
    return { state: "valid", value: attribute.value.trim() };
  }

  return { state: "invalid", value: null };
};

const getNavigationName = (
  node: JsxOpeningLikeElement,
  tagName: string
): NavigationName => {
  const explicitName =
    getAttributeName(node, "aria-label") ??
    getAttributeName(node, "aria-labelledby");

  if (explicitName) {
    return explicitName;
  }

  return tagName === "NavigationMenu"
    ? { state: "valid", value: RADIX_DEFAULT_NAVIGATION_NAME }
    : { state: "invalid", value: null };
};

const failForPair = (
  left: NavigationLandmark,
  right: NavigationLandmark
): AuditRuleResult | null => {
  if (left.name.state === "invalid" || right.name.state === "invalid") {
    const unnamed = left.name.state === "invalid" ? left : right;
    return fail(
      "Multiple concurrent navigation landmarks exist and at least one has no accessible name.",
      "Give each concurrent nav or NavigationMenu a distinct aria-label or aria-labelledby value.",
      {
        filePath: unnamed.file.filePath,
        line: unnamed.line,
      }
    );
  }

  if (left.name.state === "unknown" || right.name.state === "unknown") {
    const uncertain = left.name.state === "unknown" ? left : right;
    return advisory(
      "A concurrent navigation landmark uses a dynamic name that cannot be verified statically.",
      "Ensure every concurrently visible navigation label resolves to distinct, meaningful text.",
      uncertain.file.filePath,
      uncertain.line
    );
  }

  if (left.name.value === right.name.value) {
    return fail(
      `Concurrent navigation landmarks share the accessible name "${left.name.value}".`,
      "Give each concurrently visible navigation landmark a distinct accessible name.",
      {
        filePath: right.file.filePath,
        line: right.line,
      }
    );
  }

  return null;
};

const evaluateOwnedLandmarks = (
  landmarks: NavigationLandmark[]
): AuditRuleResult | null => {
  for (const [leftIndex, left] of landmarks.entries()) {
    for (const right of landmarks.slice(leftIndex + 1)) {
      const overlap = responsiveVisibilitiesOverlap(
        left.visibility,
        right.visibility
      );

      if (overlap === false) {
        continue;
      }

      if (overlap === null) {
        return advisory(
          "Navigation visibility is dynamic, so concurrent landmarks cannot be verified statically.",
          "Verify that every pair visible at the same viewport has a distinct accessible name.",
          left.file.filePath,
          left.line
        );
      }

      const pairFailure = failForPair(left, right);

      if (pairFailure) {
        return pairFailure;
      }
    }
  }

  return null;
};

const navLandmarksHaveNamesRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description:
    "Checks concurrent navigation landmarks for distinguishing accessible names.",
  id: "nav-landmarks-have-names",
  maxScore: 2,
  run: async ({ project }) => {
    const files = (await parseProjectSourceFiles(project)).filter(
      (file) => !GENERATED_UI_PATH_PATTERN.test(file.filePath)
    );
    const landmarks: NavigationLandmark[] = [];

    visitJsxNodes(files, ({ ancestors, file, node }) => {
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
        name: getNavigationName(node, tagName),
        ownerKey: getOwnerKey(file, ancestors),
        visibility: getResponsiveVisibility(node, ancestors),
      });
    });

    if (landmarks.length <= 1) {
      return pass("The app has at most one navigation landmark per surface.");
    }

    const landmarksByOwner = new Map<string, NavigationLandmark[]>();

    for (const landmark of landmarks) {
      const ownedLandmarks = landmarksByOwner.get(landmark.ownerKey) ?? [];
      ownedLandmarks.push(landmark);
      landmarksByOwner.set(landmark.ownerKey, ownedLandmarks);
    }

    for (const ownedLandmarks of landmarksByOwner.values()) {
      const result = evaluateOwnedLandmarks(ownedLandmarks);

      if (result) {
        return result;
      }
    }

    if (landmarksByOwner.size > 1) {
      const firstLandmark = landmarks[0];
      return advisory(
        "Navigation landmarks occur in separate component surfaces whose runtime composition is unknown.",
        "Verify that landmarks rendered together have distinct accessible names.",
        firstLandmark?.file.filePath,
        firstLandmark?.line
      );
    }

    return pass(
      `All ${landmarks.length} co-renderable navigation landmarks are distinct or responsively exclusive.`
    );
  },
  severity: "warning",
  title: "multiple navigation landmarks are named",
};

export { navLandmarksHaveNamesRule };
