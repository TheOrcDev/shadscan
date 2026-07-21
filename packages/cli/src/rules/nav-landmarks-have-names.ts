import { isJsxSpreadAttribute } from "typescript";
import { type EvidenceState, getJsxAttributeValue } from "../ast";
import type { AuditRule, AuditRuleResult } from "../audit";
import {
  buildComponentRenderGraph,
  type ComponentRenderGraph,
  type ComponentRenderSurface,
  guardsCanCoexist,
  type RenderedJsxInstance,
} from "../component-render-graph";
import { compareCodeUnits } from "../deterministic-order";
import { responsiveVisibilitiesOverlap } from "./responsive-visibility";
import { advisory, fail, pass } from "./rule-result";

interface NavigationName {
  state: EvidenceState;
  value: string | null;
}

interface NavigationLandmark {
  instance: RenderedJsxInstance;
  name: NavigationName;
}

interface SurfaceEvaluation {
  advisoryResult: AuditRuleResult | null;
  failure: AuditRuleResult | null;
  landmarkCount: number;
}

const NAVIGATION_TAGS = new Set(["NavigationMenu", "nav"]);
const GENERATED_UI_PATH_PATTERN = /[/\\]components[/\\]ui[/\\]/;
const RADIX_DEFAULT_NAVIGATION_NAME = "Main";

const getAttributeName = (
  instance: RenderedJsxInstance,
  attributeName: "aria-label" | "aria-labelledby"
): NavigationName | null => {
  const attribute = getJsxAttributeValue(instance.node, attributeName);

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

const getNavigationName = (instance: RenderedJsxInstance): NavigationName => {
  const explicitName =
    getAttributeName(instance, "aria-label") ??
    getAttributeName(instance, "aria-labelledby");

  if (explicitName) {
    return explicitName;
  }

  if (
    instance.tagName === "nav" &&
    instance.node.attributes.properties.some(isJsxSpreadAttribute)
  ) {
    return { state: "unknown", value: null };
  }

  return instance.tagName === "NavigationMenu"
    ? { state: "valid", value: RADIX_DEFAULT_NAVIGATION_NAME }
    : { state: "invalid", value: null };
};

const getLandmarks = (surface: ComponentRenderSurface): NavigationLandmark[] =>
  surface.instances
    .filter((instance) => {
      if (!NAVIGATION_TAGS.has(instance.tagName)) {
        return false;
      }

      if (instance.tagName === "nav") {
        return !GENERATED_UI_PATH_PATTERN.test(instance.file.filePath);
      }

      return (
        instance.resolution !== "resolved" ||
        Boolean(
          instance.resolvedTargetFilePath &&
            GENERATED_UI_PATH_PATTERN.test(instance.resolvedTargetFilePath)
        )
      );
    })
    .map((instance) => ({
      instance,
      name: getNavigationName(instance),
    }));

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
        filePath: unnamed.instance.file.filePath,
        line: unnamed.instance.line,
      }
    );
  }

  if (
    left.name.state === "valid" &&
    right.name.state === "valid" &&
    left.name.value === right.name.value
  ) {
    return fail(
      `Concurrent navigation landmarks share the accessible name "${left.name.value}".`,
      "Give each concurrently visible navigation landmark a distinct accessible name.",
      {
        filePath: right.instance.file.filePath,
        line: right.instance.line,
      }
    );
  }

  return null;
};

const getDynamicNameAdvisory = (
  left: NavigationLandmark,
  right: NavigationLandmark
): AuditRuleResult | null => {
  if (left.name.state !== "unknown" && right.name.state !== "unknown") {
    return null;
  }

  const uncertain = left.name.state === "unknown" ? left : right;
  return advisory(
    "A concurrent navigation landmark uses a dynamic name that cannot be verified statically.",
    "Ensure every concurrently visible navigation label resolves to distinct, meaningful text.",
    uncertain.instance.file.filePath,
    uncertain.instance.line
  );
};

const evaluatePair = (
  left: NavigationLandmark,
  right: NavigationLandmark
): AuditRuleResult | null => {
  if (!guardsCanCoexist(left.instance.guards, right.instance.guards)) {
    return null;
  }

  const overlap = responsiveVisibilitiesOverlap(
    left.instance.visibility,
    right.instance.visibility
  );

  if (overlap === false) {
    return null;
  }

  if (overlap === null) {
    return advisory(
      "Navigation visibility is dynamic, so concurrent landmarks cannot be verified statically.",
      "Verify that every pair visible at the same viewport has a distinct accessible name.",
      left.instance.file.filePath,
      left.instance.line
    );
  }

  const uncertainInstance = [left, right].find(
    (landmark) =>
      landmark.instance.multiplicity === "unknown" ||
      landmark.instance.uncertaintyReasons.length > 0
  );
  if (uncertainInstance) {
    return advisory(
      "Navigation composition or multiplicity is dynamic, so concurrent landmarks cannot be proven statically.",
      "Verify that every navigation landmark rendered together has a distinct accessible name.",
      uncertainInstance.instance.file.filePath,
      uncertainInstance.instance.line
    );
  }

  return failForPair(left, right) ?? getDynamicNameAdvisory(left, right);
};

const evaluateSurface = (
  surface: ComponentRenderSurface
): SurfaceEvaluation => {
  const landmarks = getLandmarks(surface);
  let advisoryResult: AuditRuleResult | null = null;

  for (const [leftIndex, left] of landmarks.entries()) {
    for (const right of landmarks.slice(leftIndex + 1)) {
      const result = evaluatePair(left, right);

      if (result?.status === "fail") {
        return {
          advisoryResult,
          failure: result,
          landmarkCount: landmarks.length,
        };
      }

      if (result?.status === "advisory" && !advisoryResult) {
        advisoryResult = result;
      }
    }
  }

  return { advisoryResult, failure: null, landmarkCount: landmarks.length };
};

const getBoundaryAdvisory = (
  graph: ComponentRenderGraph,
  surfaces: ComponentRenderSurface[]
): AuditRuleResult | null => {
  const partialSurface = surfaces.find(
    (surface) => surface.boundaryReasons.length > 0
  );
  const reason =
    graph.boundaryReasons[0] ?? partialSurface?.boundaryReasons[0] ?? null;

  if (!reason) {
    return null;
  }

  const firstNavigation = partialSurface
    ? getLandmarks(partialSurface)[0]?.instance
    : null;
  return advisory(
    `Navigation composition is only partially known: ${reason}`,
    "Verify that every navigation landmark rendered together has a distinct accessible name.",
    firstNavigation?.file.filePath,
    firstNavigation?.line
  );
};

const evaluateNavigationRenderGraph = (
  graph: ComponentRenderGraph
): AuditRuleResult => {
  const surfaces = [...graph.surfaces].sort((left, right) =>
    compareCodeUnits(left.id, right.id)
  );
  let firstAdvisory: AuditRuleResult | null = null;
  let landmarkCount = 0;

  for (const surface of surfaces) {
    const evaluation = evaluateSurface(surface);
    landmarkCount += evaluation.landmarkCount;

    if (evaluation.failure) {
      return evaluation.failure;
    }

    firstAdvisory ??= evaluation.advisoryResult;
  }

  if (firstAdvisory) {
    return firstAdvisory;
  }

  const boundaryAdvisory = getBoundaryAdvisory(graph, surfaces);
  if (boundaryAdvisory) {
    return boundaryAdvisory;
  }

  if (landmarkCount <= 1) {
    return pass(
      "The app has at most one navigation landmark per render surface."
    );
  }

  return pass(
    `All ${landmarkCount} rendered navigation landmarks are distinct, mutually exclusive, or on separate route surfaces.`
  );
};

const navLandmarksHaveNamesRule: AuditRule = {
  adapters: ["core"],
  category: "accessibility",
  confidence: "high",
  description:
    "Checks navigation landmark instances that share a proven render surface for distinguishing accessible names.",
  id: "nav-landmarks-have-names",
  maxScore: 2,
  run: async ({ filesystemRoot, project }) => {
    const graph = await buildComponentRenderGraph(project, filesystemRoot);
    return evaluateNavigationRenderGraph(graph);
  },
  severity: "warning",
  title: "multiple navigation landmarks are named",
};

export { evaluateNavigationRenderGraph, navLandmarksHaveNamesRule };
