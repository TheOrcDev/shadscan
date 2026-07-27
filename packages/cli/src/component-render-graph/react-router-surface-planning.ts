import path from "node:path";
import { isCallExpression, isIdentifier, isStringLiteral } from "typescript";
import { walkNodes } from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import { addSurfacePlan } from "./surface-plan-budget";
import { getRecordDefault, getRecordNamed } from "./symbol-resolution";
import type {
  ComponentSeed,
  FileRecord,
  GraphBuildState,
  SurfacePlan,
} from "./types";

const ROUTE_MODULE_EXTENSION_PATTERN = /\.[jt]sx?$/;
const FLAT_ROUTES_PATTERN = /\bflatRoutes\s*\(/;
/** Route helpers whose module path argument is a string literal. */
const ROUTE_HELPERS_WITH_PATH_ARG = new Set(["layout", "index", "route"]);
/** Exports that render real UI and therefore deserve their own surface root. */
const ROUTE_UI_EXPORTS = ["ErrorBoundary", "HydrateFallback"] as const;

const isUnderDirectory = (filePath: string, directory: string): boolean => {
  const relativePath = path.relative(directory, filePath);

  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

const resolveRouteRecord = (
  appDir: string,
  modulePath: string,
  state: GraphBuildState
): FileRecord | null => {
  const base = path.resolve(appDir, modulePath);

  for (const suffix of ["", ".tsx", ".ts", ".jsx", ".js"]) {
    const record = state.fileRecords.get(path.resolve(`${base}${suffix}`));

    if (record) {
      return record;
    }
  }

  return null;
};

/**
 * Read `app/routes.ts` for the literal helper forms the template generates:
 * `index("routes/home.tsx")`, `route("path", "routes/thing.tsx")`, and
 * `layout("routes/shell.tsx")`. Returns null when the config is absent or
 * uses forms this cannot read statically, so the caller falls back to a
 * directory glob rather than reporting partial coverage as complete.
 */
const getConfiguredRouteModules = (
  appDir: string,
  state: GraphBuildState
): { modulePaths: string[]; usesUnreadableForm: boolean } | null => {
  const configRecord =
    state.fileRecords.get(path.resolve(appDir, "routes.ts")) ??
    state.fileRecords.get(path.resolve(appDir, "routes.js"));

  if (!configRecord) {
    return null;
  }

  if (FLAT_ROUTES_PATTERN.test(configRecord.parsed.content)) {
    return { modulePaths: [], usesUnreadableForm: true };
  }

  const modulePaths: string[] = [];
  let usesUnreadableForm = false;

  walkNodes(configRecord.parsed.sourceFile, (node) => {
    if (!(isCallExpression(node) && isIdentifier(node.expression))) {
      return;
    }

    if (!ROUTE_HELPERS_WITH_PATH_ARG.has(node.expression.text)) {
      return;
    }

    // `route()` takes ("path", "module"); index/layout take ("module").
    const argument =
      node.expression.text === "route" ? node.arguments[1] : node.arguments[0];

    if (argument && isStringLiteral(argument)) {
      modulePaths.push(argument.text);
      return;
    }

    if (argument) {
      usesUnreadableForm = true;
    }
  });

  return { modulePaths, usesUnreadableForm };
};

const getRouteKey = (appDir: string, filePath: string): string =>
  path
    .relative(appDir, filePath)
    .replace(ROUTE_MODULE_EXTENSION_PATTERN, "")
    .split(path.sep)
    .join("/");

const collectRouteRoots = (
  record: FileRecord,
  state: GraphBuildState,
  boundaryReasons: string[]
): ComponentSeed[] => {
  const roots: ComponentSeed[] = [];
  const relativePath = path.relative(
    state.project.rootDir,
    record.parsed.filePath
  );
  const defaultNode = getRecordDefault(record, state);

  if (defaultNode) {
    roots.push({ componentId: defaultNode.id, projectedChildren: null });
  } else {
    boundaryReasons.push(
      `Route module ${relativePath} has no resolvable default component export.`
    );
  }

  // ErrorBoundary and HydrateFallback render on real navigations, so they are
  // audited surfaces in their own right rather than dead code.
  for (const exportName of ROUTE_UI_EXPORTS) {
    const node = getRecordNamed(record, exportName, state);

    if (node) {
      roots.push({ componentId: node.id, projectedChildren: null });
    }
  }

  return roots;
};

const addReactRouterSurfacePlans = (
  state: GraphBuildState,
  plans: SurfacePlan[]
): void => {
  const appDir = state.project.paths.reactRouterAppDir;

  if (!appDir || state.surfacePlanningHalted) {
    return;
  }

  const resolvedAppDir = path.resolve(appDir);
  const rootModulePath = state.project.paths.reactRouterRoot
    ? path.resolve(state.project.paths.reactRouterRoot)
    : null;
  const configured = getConfiguredRouteModules(appDir, state);
  let routeRecords: FileRecord[] = [];

  if (configured && configured.modulePaths.length > 0) {
    routeRecords = configured.modulePaths
      .map((modulePath) => resolveRouteRecord(appDir, modulePath, state))
      .filter((record): record is FileRecord => record !== null);
  }

  if (configured?.usesUnreadableForm) {
    state.graphBoundaryReasons.add(
      "The React Router route config uses forms that are not statically readable; route surfaces fall back to directory discovery."
    );
  }

  if (routeRecords.length === 0) {
    routeRecords = [...state.fileRecords.values()].filter((record) => {
      const resolved = path.resolve(record.parsed.filePath);

      return (
        resolved !== rootModulePath &&
        isUnderDirectory(resolved, path.join(resolvedAppDir, "routes")) &&
        ROUTE_MODULE_EXTENSION_PATTERN.test(resolved)
      );
    });
  }

  const rootRecord = rootModulePath
    ? state.fileRecords.get(rootModulePath)
    : null;
  const orderedRecords = [...(rootRecord ? [rootRecord] : []), ...routeRecords]
    .filter(
      (record, index, all) =>
        all.findIndex(
          (candidate) => candidate.parsed.filePath === record.parsed.filePath
        ) === index
    )
    .sort((left, right) =>
      compareCodeUnits(left.parsed.filePath, right.parsed.filePath)
    );

  for (const record of orderedRecords) {
    const boundaryReasons: string[] = [];
    const roots = collectRouteRoots(record, state, boundaryReasons);

    if (roots.length === 0 && boundaryReasons.length === 0) {
      continue;
    }

    const routeKey = getRouteKey(appDir, record.parsed.filePath);
    const added = addSurfacePlan(state, plans, {
      adapter: "react-router-framework",
      boundaryReasons,
      dynamicComponent: null,
      id: `react-router:${routeKey}`,
      roots,
      routeKey,
    });

    if (!added) {
      return;
    }
  }
};

export { addReactRouterSurfacePlans };
