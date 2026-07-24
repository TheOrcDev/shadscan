import path from "node:path";
import {
  type CallExpression,
  type Expression,
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
  type ObjectLiteralExpression,
} from "typescript";
import { walkNodes } from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import { addSurfacePlan } from "./surface-plan-budget";
import { resolveElementTarget } from "./symbol-resolution";
import type {
  ComponentSeed,
  FileRecord,
  GraphBuildState,
  SurfacePlan,
} from "./types";

const ROUTE_FACTORY_NAMES = new Set([
  "createFileRoute",
  "createRootRoute",
  "createRootRouteWithContext",
]);
const ROUTE_COMPONENT_OPTIONS = [
  "component",
  "errorComponent",
  "notFoundComponent",
  "pendingComponent",
  "shellComponent",
] as const;
const OUTLET_PATTERN = /<Outlet\b/;
const ROUTE_FILE_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/;
const TRAILING_INDEX_SEGMENT_PATTERN = /(?:^|\/)index$/;
const TRAILING_SLASHES_PATTERN = /\/+$/;

const getRouteFactoryName = (call: CallExpression): string | null => {
  if (isIdentifier(call.expression)) {
    return ROUTE_FACTORY_NAMES.has(call.expression.text)
      ? call.expression.text
      : null;
  }

  // Curried forms: createFileRoute("/path")({...}) and
  // createRootRouteWithContext<Context>()({...}).
  if (
    isCallExpression(call.expression) &&
    isIdentifier(call.expression.expression)
  ) {
    return ROUTE_FACTORY_NAMES.has(call.expression.expression.text)
      ? call.expression.expression.text
      : null;
  }

  return null;
};

const getRouteOptions = (
  record: FileRecord
): ObjectLiteralExpression | null => {
  let options: ObjectLiteralExpression | null = null;

  walkNodes(record.parsed.sourceFile, (node) => {
    if (options || !isCallExpression(node)) {
      return;
    }

    if (!getRouteFactoryName(node)) {
      return;
    }

    const firstArgument: Expression | undefined = node.arguments[0];

    if (
      firstArgument &&
      !isStringLiteral(firstArgument) &&
      isObjectLiteralExpression(firstArgument)
    ) {
      options = firstArgument;
    }
  });

  return options;
};

const getRouteComponentSeeds = (
  record: FileRecord,
  options: ObjectLiteralExpression,
  state: GraphBuildState,
  boundaryReasons: string[]
): ComponentSeed[] => {
  const seeds: ComponentSeed[] = [];
  const relativePath = path.relative(
    state.project.rootDir,
    record.parsed.filePath
  );

  for (const optionName of ROUTE_COMPONENT_OPTIONS) {
    const property = options.properties.find(
      (candidate) =>
        isPropertyAssignment(candidate) &&
        isIdentifier(candidate.name) &&
        candidate.name.text === optionName
    );

    if (!(property && isPropertyAssignment(property))) {
      continue;
    }

    if (!isIdentifier(property.initializer)) {
      boundaryReasons.push(
        `Route option ${optionName} in ${relativePath} is not a statically resolvable component reference.`
      );
      continue;
    }

    const resolved = resolveElementTarget(
      record,
      property.initializer.text,
      state
    );

    if (!resolved.target) {
      boundaryReasons.push(
        resolved.boundaryReason ??
          `Route option ${optionName} in ${relativePath} references component ${property.initializer.text}, which could not be resolved.`
      );
      continue;
    }

    seeds.push({ componentId: resolved.target.id, projectedChildren: null });
  }

  return seeds;
};

const getStartRouteKey = (routesDir: string, filePath: string): string => {
  const relativePath = path
    .relative(routesDir, filePath)
    .replace(ROUTE_FILE_EXTENSION_PATTERN, "")
    .split(path.sep)
    .join("/");

  if (relativePath === "__root") {
    return "__root";
  }

  const withoutIndex = relativePath.replace(TRAILING_INDEX_SEGMENT_PATTERN, "");
  return `/${withoutIndex}`.replace(TRAILING_SLASHES_PATTERN, "") || "/";
};

const addStartSurfacePlans = (
  state: GraphBuildState,
  plans: SurfacePlan[]
): void => {
  const routesDir = state.project.paths.routesDir;

  if (!routesDir || state.surfacePlanningHalted) {
    return;
  }

  const resolvedRoutesDir = path.resolve(routesDir);
  const routeRecords = [...state.fileRecords.values()]
    .filter((record) =>
      path
        .resolve(record.parsed.filePath)
        .startsWith(`${resolvedRoutesDir}${path.sep}`)
    )
    .sort((left, right) =>
      compareCodeUnits(left.parsed.filePath, right.parsed.filePath)
    );

  for (const record of routeRecords) {
    const options = getRouteOptions(record);

    if (!options) {
      continue;
    }

    const boundaryReasons: string[] = [];
    const roots = getRouteComponentSeeds(
      record,
      options,
      state,
      boundaryReasons
    );

    if (OUTLET_PATTERN.test(record.parsed.content)) {
      boundaryReasons.push(
        "TanStack Start Outlet composition is not statically expanded."
      );
    }

    if (roots.length === 0 && boundaryReasons.length === 0) {
      continue;
    }

    const routeKey = getStartRouteKey(routesDir, record.parsed.filePath);
    const added = addSurfacePlan(state, plans, {
      adapter: "tanstack-start",
      boundaryReasons,
      dynamicComponent: null,
      id: `tanstack-start:${routeKey}:${path.relative(routesDir, record.parsed.filePath)}`,
      roots,
      routeKey,
    });

    if (!added) {
      return;
    }
  }
};

export { addStartSurfacePlans };
