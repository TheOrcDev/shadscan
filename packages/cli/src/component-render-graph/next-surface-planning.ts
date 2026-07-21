import path from "node:path";
import {
  isArrayLiteralExpression,
  isIdentifier,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isStringLiteralLike,
  isVariableStatement,
} from "typescript";
import { walkNodes } from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import { getNamedSlotBindings } from "./component-properties";
import {
  GET_LAYOUT_PATTERN,
  NEXT_INTERCEPTION_SEGMENT_PATTERN,
  ROUTE_GROUP_SEGMENT_PATTERN,
  TRAILING_SLASH_PATTERN,
} from "./constants";
import { addSurfacePlan } from "./surface-plan-budget";
import { getRecordDefault } from "./symbol-resolution";
import type {
  ComponentNodeRecord,
  ComponentSeed,
  FileRecord,
  GraphBuildState,
  PagesAppContext,
  RenderTemplateItem,
  SurfacePlan,
} from "./types";

const NEXT_CONFIG_FILE_PATTERN = /^next\.config\.[cm]?[jt]s$/;
const DEFAULT_PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js"] as const;

interface PageExtensionConfig {
  extensions: readonly string[];
  partial: boolean;
}

const getStringArray = (
  expression: import("typescript").Expression
): string[] | null => {
  if (!isArrayLiteralExpression(expression)) {
    return null;
  }
  const values: string[] = [];
  for (const element of expression.elements) {
    if (!isStringLiteralLike(element)) {
      return null;
    }
    values.push(element.text);
  }
  return values;
};

const getSortedRecords = (state: GraphBuildState): FileRecord[] =>
  [...state.fileRecords.values()].sort((left, right) =>
    compareCodeUnits(left.parsed.filePath, right.parsed.filePath)
  );

const getPageExtensionConfig = (
  state: GraphBuildState
): PageExtensionConfig => {
  const config = getSortedRecords(state).find((record) =>
    NEXT_CONFIG_FILE_PATTERN.test(path.basename(record.parsed.filePath))
  );
  if (!config) {
    return { extensions: DEFAULT_PAGE_EXTENSIONS, partial: false };
  }

  const arrays = new Map<string, readonly string[]>();
  for (const statement of config.parsed.sourceFile.statements) {
    if (!isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        isIdentifier(declaration.name) &&
        declaration.initializer &&
        isArrayLiteralExpression(declaration.initializer)
      ) {
        const values = getStringArray(declaration.initializer);
        if (!values) {
          continue;
        }
        arrays.set(declaration.name.text, values);
      }
    }
  }

  let found = false;
  let extensions: readonly string[] | null = null;
  walkNodes(config.parsed.sourceFile, (node) => {
    if (!(isPropertyAssignment(node) || isShorthandPropertyAssignment(node))) {
      return;
    }
    const propertyName = node.name.getText(config.parsed.sourceFile);
    if (
      !["pageExtensions", '"pageExtensions"', "'pageExtensions'"].includes(
        propertyName
      )
    ) {
      return;
    }
    found = true;
    if (isShorthandPropertyAssignment(node)) {
      extensions = arrays.get(node.name.text) ?? null;
    } else if (isArrayLiteralExpression(node.initializer)) {
      extensions = getStringArray(node.initializer);
    } else if (isIdentifier(node.initializer)) {
      extensions = arrays.get(node.initializer.text) ?? null;
    }
  });

  return found && extensions
    ? { extensions, partial: false }
    : { extensions: DEFAULT_PAGE_EXTENSIONS, partial: found };
};

const getConventionName = (
  filePath: string,
  convention: string,
  extensions: readonly string[]
): boolean =>
  extensions.some(
    (extension) => path.basename(filePath) === `${convention}.${extension}`
  );

const hasPrivateAppSegment = (appDir: string, filePath: string): boolean =>
  path
    .relative(appDir, filePath)
    .split(path.sep)
    .slice(0, -1)
    .some((segment) => segment.startsWith("_"));

const getAppRouteKey = (appDir: string, filePath: string): string => {
  const relativeDirectory = path.relative(appDir, path.dirname(filePath));
  return (
    `/${relativeDirectory
      .split(path.sep)
      .filter(
        (segment) => segment && !ROUTE_GROUP_SEGMENT_PATTERN.test(segment)
      )
      .join("/")}`.replace(TRAILING_SLASH_PATTERN, "") || "/"
  );
};

const hasUnsupportedAppRouteSegment = (
  appDir: string,
  filePath: string
): boolean =>
  path
    .relative(appDir, filePath)
    .split(path.sep)
    .some((segment) => NEXT_INTERCEPTION_SEGMENT_PATTERN.test(segment));

const getAncestorDirectories = (
  appDir: string,
  pagePath: string,
  state: GraphBuildState
): string[] => {
  const directories: string[] = [];
  let current = path.dirname(pagePath);

  while (state.host.isPathAllowed(current)) {
    directories.push(current);
    if (path.resolve(current) === path.resolve(appDir)) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return directories.reverse();
};

const getAncestorAppWrappers = (
  appDir: string,
  pagePath: string,
  state: GraphBuildState,
  wrappersByDirectory: ReadonlyMap<string, FileRecord[]>
): FileRecord[] =>
  getAncestorDirectories(appDir, pagePath, state).flatMap(
    (directory) => wrappersByDirectory.get(path.resolve(directory)) ?? []
  );

const getAppWrappersByDirectory = (
  records: FileRecord[],
  extensions: readonly string[]
): ReadonlyMap<string, FileRecord[]> => {
  const wrappers = new Map<string, FileRecord[]>();
  for (const record of records) {
    const isWrapper =
      getConventionName(record.parsed.filePath, "layout", extensions) ||
      getConventionName(record.parsed.filePath, "template", extensions);
    if (!isWrapper) {
      continue;
    }
    const directory = path.dirname(record.parsed.filePath);
    const directoryWrappers = wrappers.get(directory) ?? [];
    directoryWrappers.push(record);
    wrappers.set(directory, directoryWrappers);
  }
  return wrappers;
};

const hasParallelSlots = (
  appDir: string,
  pagePath: string,
  state: GraphBuildState
): boolean => {
  const ancestors = getAncestorDirectories(appDir, pagePath, state);

  for (const directory of ancestors) {
    for (const record of state.fileRecords.values()) {
      const relative = path.relative(directory, record.parsed.filePath);
      const firstSegment = relative.split(path.sep)[0];
      if (
        firstSegment &&
        !relative.startsWith("..") &&
        firstSegment.startsWith("@")
      ) {
        return true;
      }
    }
  }

  return false;
};

const wrapSeedWithAppWrappers = (
  pageNode: ComponentNodeRecord,
  wrappers: FileRecord[],
  state: GraphBuildState,
  boundaryReasons: string[]
): ComponentSeed => {
  let seed: ComponentSeed = {
    componentId: pageNode.id,
    projectedChildren: null,
  };

  for (const wrapperRecord of [...wrappers].reverse()) {
    const wrapperNode = getRecordDefault(wrapperRecord, state);
    const relativePath = path.relative(
      state.project.rootDir,
      wrapperRecord.parsed.filePath
    );

    if (!wrapperNode) {
      boundaryReasons.push(
        `App Router wrapper ${relativePath} has no resolvable default component.`
      );
      continue;
    }

    if (wrapperNode.childrenProjection !== "projected") {
      boundaryReasons.push(
        wrapperNode.childrenProjection === "unknown"
          ? `App Router wrapper ${relativePath} has an uncertain children projection.`
          : `App Router wrapper ${relativePath} has no recognizable children projection.`
      );
    }

    const namedSlots = getNamedSlotBindings(wrapperNode.declaration);
    if (namedSlots.length > 0) {
      boundaryReasons.push(
        `App Router wrapper ${relativePath} uses unsupported named slot props: ${namedSlots.join(", ")}.`
      );
    }

    seed = {
      componentId: wrapperNode.id,
      projectedChildren: { kind: "component", seed },
    };
  }

  return seed;
};

const addAppLoadingSurfacePlans = (
  appDir: string,
  extensions: readonly string[],
  records: FileRecord[],
  state: GraphBuildState,
  plans: SurfacePlan[],
  wrappersByDirectory: ReadonlyMap<string, FileRecord[]>
): void => {
  for (const loadingRecord of records) {
    const isLoadingFile =
      path
        .resolve(loadingRecord.parsed.filePath)
        .startsWith(`${path.resolve(appDir)}${path.sep}`) &&
      getConventionName(loadingRecord.parsed.filePath, "loading", extensions);
    if (
      !isLoadingFile ||
      hasPrivateAppSegment(appDir, loadingRecord.parsed.filePath)
    ) {
      continue;
    }
    const loadingNode = getRecordDefault(loadingRecord, state);
    const boundaryReasons: string[] = [];
    if (!loadingNode) {
      boundaryReasons.push(
        "The App Router loading fallback has no resolvable default component."
      );
    }
    const routeKey = getAppRouteKey(appDir, loadingRecord.parsed.filePath);
    const added = addSurfacePlan(state, plans, {
      adapter: "next-app-router",
      boundaryReasons,
      dynamicComponent: null,
      id: `next-app-loading:${routeKey}:${path.relative(appDir, loadingRecord.parsed.filePath)}`,
      roots: loadingNode
        ? [
            wrapSeedWithAppWrappers(
              loadingNode,
              getAncestorAppWrappers(
                appDir,
                loadingRecord.parsed.filePath,
                state,
                wrappersByDirectory
              ),
              state,
              boundaryReasons
            ),
          ]
        : [],
      routeKey,
    });
    if (!added) {
      return;
    }
  }
};

const addAppSurfacePlans = (
  state: GraphBuildState,
  plans: SurfacePlan[]
): void => {
  const appDir = state.project.paths.appDir;
  if (!appDir || state.surfacePlanningHalted) {
    return;
  }

  const extensionConfig = getPageExtensionConfig(state);
  if (extensionConfig.partial) {
    return;
  }
  const { extensions } = extensionConfig;
  const records = getSortedRecords(state);
  const wrappersByDirectory = getAppWrappersByDirectory(records, extensions);
  for (const pageRecord of records) {
    if (
      !(
        path
          .resolve(pageRecord.parsed.filePath)
          .startsWith(`${path.resolve(appDir)}${path.sep}`) &&
        getConventionName(pageRecord.parsed.filePath, "page", extensions) &&
        !hasPrivateAppSegment(appDir, pageRecord.parsed.filePath)
      )
    ) {
      continue;
    }

    const routeKey = getAppRouteKey(appDir, pageRecord.parsed.filePath);
    const boundaryReasons: string[] = [];
    const pageNode = getRecordDefault(pageRecord, state);

    if (hasUnsupportedAppRouteSegment(appDir, pageRecord.parsed.filePath)) {
      boundaryReasons.push(
        "Interception route composition is not statically expanded."
      );
    }

    if (hasParallelSlots(appDir, pageRecord.parsed.filePath, state)) {
      boundaryReasons.push(
        "Parallel route slot composition is not statically expanded."
      );
    }

    if (!pageNode) {
      boundaryReasons.push(
        "The App Router page has no resolvable default component."
      );
    }

    const added = addSurfacePlan(state, plans, {
      adapter: "next-app-router",
      boundaryReasons,
      dynamicComponent: null,
      id: `next-app:${routeKey}:${path.relative(appDir, pageRecord.parsed.filePath)}`,
      roots: pageNode
        ? [
            wrapSeedWithAppWrappers(
              pageNode,
              getAncestorAppWrappers(
                appDir,
                pageRecord.parsed.filePath,
                state,
                wrappersByDirectory
              ),
              state,
              boundaryReasons
            ),
          ]
        : [],
      routeKey,
    });

    if (!added) {
      return;
    }
  }

  addAppLoadingSurfacePlans(
    appDir,
    extensions,
    records,
    state,
    plans,
    wrappersByDirectory
  );
};

const isPagesRouteFile = (
  pagesDir: string,
  filePath: string,
  extensions: readonly string[]
): boolean => {
  const relative = path.relative(pagesDir, filePath);
  const segments = relative.split(path.sep);
  const basename = path.basename(relative);

  return (
    !relative.startsWith("..") &&
    extensions.some((extension) => relative.endsWith(`.${extension}`)) &&
    segments[0] !== "api" &&
    !basename.startsWith("_")
  );
};

const getPagesRouteKey = (
  pagesDir: string,
  filePath: string,
  extensions: readonly string[]
): string => {
  const matchingExtension = [...extensions]
    .sort((left, right) => right.length - left.length)
    .find((extension) => filePath.endsWith(`.${extension}`));
  const relative = matchingExtension
    ? path
        .relative(pagesDir, filePath)
        .slice(0, -(matchingExtension.length + 1))
    : path.relative(pagesDir, filePath);
  let route = relative;

  if (relative.endsWith(`${path.sep}index`)) {
    route = relative.slice(0, -`${path.sep}index`.length);
  } else if (relative === "index") {
    route = "";
  }
  return `/${route.split(path.sep).join("/")}`;
};

const templateHasTag = (
  items: RenderTemplateItem[],
  tagName: string
): boolean =>
  items.some(
    (item) =>
      item.kind === "element" &&
      (item.edge.tagName === tagName || templateHasTag(item.children, tagName))
  );

const createPagesSurfacePlan = (
  pagesDir: string,
  pageRecord: FileRecord,
  app: PagesAppContext,
  state: GraphBuildState,
  extensions: readonly string[]
): SurfacePlan => {
  const routeKey = getPagesRouteKey(
    pagesDir,
    pageRecord.parsed.filePath,
    extensions
  );
  const boundaryReasons: string[] = [];
  const pageNode = getRecordDefault(pageRecord, state);
  const hasGetLayout = GET_LAYOUT_PATTERN.test(
    `${pageRecord.parsed.content}\n${app.appRecord?.parsed.content ?? ""}`
  );

  if (!pageNode) {
    boundaryReasons.push(
      "The Pages Router page has no resolvable default component."
    );
  }

  if (hasGetLayout) {
    boundaryReasons.push(
      "Pages Router getLayout composition is dynamic and was not expanded."
    );
  } else if (app.appRecord && !(app.appNode && app.rendersComponent)) {
    boundaryReasons.push(
      "The custom App does not directly render its Component prop."
    );
  }

  const pageSeed = pageNode
    ? { componentId: pageNode.id, projectedChildren: null }
    : null;
  const useCustomApp = Boolean(
    pageSeed && app.appNode && app.rendersComponent && !hasGetLayout
  );
  let roots: ComponentSeed[] = pageSeed ? [pageSeed] : [];
  if (useCustomApp) {
    roots = [{ componentId: app.appNode?.id ?? "", projectedChildren: null }];
  }

  return {
    adapter: "next-pages-router",
    boundaryReasons,
    dynamicComponent: useCustomApp ? pageSeed : null,
    id: `next-pages:${routeKey}:${path.relative(pagesDir, pageRecord.parsed.filePath)}`,
    roots,
    routeKey,
  };
};

const addPagesSurfacePlans = (
  state: GraphBuildState,
  plans: SurfacePlan[]
): void => {
  const pagesDir = state.project.paths.pagesDir;
  if (!pagesDir || state.surfacePlanningHalted) {
    return;
  }

  const extensionConfig = getPageExtensionConfig(state);
  if (extensionConfig.partial) {
    return;
  }
  const { extensions } = extensionConfig;
  const appRecord = getSortedRecords(state).find(
    (record) =>
      path.dirname(record.parsed.filePath) === path.resolve(pagesDir) &&
      getConventionName(record.parsed.filePath, "_app", extensions)
  );
  const appNode = appRecord ? getRecordDefault(appRecord, state) : null;
  const app: PagesAppContext = {
    appNode,
    appRecord: appRecord ?? null,
    rendersComponent: Boolean(
      appNode && templateHasTag(appNode.template, "Component")
    ),
  };

  for (const pageRecord of getSortedRecords(state)) {
    if (!isPagesRouteFile(pagesDir, pageRecord.parsed.filePath, extensions)) {
      continue;
    }

    if (
      !addSurfacePlan(
        state,
        plans,
        createPagesSurfacePlan(pagesDir, pageRecord, app, state, extensions)
      )
    ) {
      return;
    }
  }
};

const addNextConfigBoundary = (state: GraphBuildState): void => {
  if (getPageExtensionConfig(state).partial) {
    state.graphBoundaryReasons.add(
      "Dynamic Next.js pageExtensions could not be read statically for render surface discovery."
    );
  }
};

export { addAppSurfacePlans, addNextConfigBoundary, addPagesSurfacePlans };
