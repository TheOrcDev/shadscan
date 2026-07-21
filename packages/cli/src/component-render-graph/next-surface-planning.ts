import path from "node:path";
import {
  isPropertyAssignment,
  isShorthandPropertyAssignment,
} from "typescript";
import { walkNodes } from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import { getNamedSlotBindings } from "./component-properties";
import {
  APP_LAYOUT_NAMES,
  APP_PAGE_PATTERN,
  APP_TEMPLATE_NAMES,
  GET_LAYOUT_PATTERN,
  NEXT_INTERCEPTION_SEGMENT_PATTERN,
  ROUTE_GROUP_SEGMENT_PATTERN,
  SCRIPT_EXTENSION_PATTERN,
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

const getSortedRecords = (state: GraphBuildState): FileRecord[] =>
  [...state.fileRecords.values()].sort((left, right) =>
    compareCodeUnits(left.parsed.filePath, right.parsed.filePath)
  );

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
  state: GraphBuildState
): FileRecord[] =>
  getAncestorDirectories(appDir, pagePath, state).flatMap((directory) =>
    [...APP_LAYOUT_NAMES, ...APP_TEMPLATE_NAMES]
      .map((fileName) =>
        state.fileRecords.get(path.resolve(directory, fileName))
      )
      .filter((record): record is FileRecord => Boolean(record))
  );

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

const addAppSurfacePlans = (
  state: GraphBuildState,
  plans: SurfacePlan[]
): void => {
  const appDir = state.project.paths.appDir;
  if (!appDir || state.surfacePlanningHalted) {
    return;
  }

  for (const pageRecord of getSortedRecords(state)) {
    if (
      !(
        path
          .resolve(pageRecord.parsed.filePath)
          .startsWith(`${path.resolve(appDir)}${path.sep}`) &&
        APP_PAGE_PATTERN.test(path.basename(pageRecord.parsed.filePath))
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
              getAncestorAppWrappers(appDir, pageRecord.parsed.filePath, state),
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

const isPagesRouteFile = (pagesDir: string, filePath: string): boolean => {
  const relative = path.relative(pagesDir, filePath);
  const segments = relative.split(path.sep);
  const basename = path.basename(relative);

  return (
    !relative.startsWith("..") &&
    SCRIPT_EXTENSION_PATTERN.test(relative) &&
    segments[0] !== "api" &&
    !basename.startsWith("_")
  );
};

const getPagesRouteKey = (pagesDir: string, filePath: string): string => {
  const relative = path
    .relative(pagesDir, filePath)
    .replace(SCRIPT_EXTENSION_PATTERN, "");
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
  state: GraphBuildState
): SurfacePlan => {
  const routeKey = getPagesRouteKey(pagesDir, pageRecord.parsed.filePath);
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

  const appRecord = APP_LAYOUT_NAMES.map((fileName) =>
    fileName.replace("layout", "_app")
  )
    .map((fileName) => state.fileRecords.get(path.resolve(pagesDir, fileName)))
    .find((record): record is FileRecord => Boolean(record));
  const appNode = appRecord ? getRecordDefault(appRecord, state) : null;
  const app: PagesAppContext = {
    appNode,
    appRecord: appRecord ?? null,
    rendersComponent: Boolean(
      appNode && templateHasTag(appNode.template, "Component")
    ),
  };

  for (const pageRecord of getSortedRecords(state)) {
    if (!isPagesRouteFile(pagesDir, pageRecord.parsed.filePath)) {
      continue;
    }

    if (
      !addSurfacePlan(
        state,
        plans,
        createPagesSurfacePlan(pagesDir, pageRecord, app, state)
      )
    ) {
      return;
    }
  }
};

const addNextConfigBoundary = (state: GraphBuildState): void => {
  const config = getSortedRecords(state).find((record) =>
    NEXT_CONFIG_FILE_PATTERN.test(path.basename(record.parsed.filePath))
  );
  let declaresPageExtensions = false;

  if (config) {
    walkNodes(config.parsed.sourceFile, (node) => {
      if (
        !(isPropertyAssignment(node) || isShorthandPropertyAssignment(node))
      ) {
        return;
      }

      const propertyName = node.name.getText(config.parsed.sourceFile);
      if (
        ["pageExtensions", '"pageExtensions"', "'pageExtensions'"].includes(
          propertyName
        )
      ) {
        declaresPageExtensions = true;
      }
    });
  }

  if (declaresPageExtensions) {
    state.graphBoundaryReasons.add(
      "Custom Next.js pageExtensions are not fully supported by render surface discovery."
    );
  }
};

export { addAppSurfacePlans, addNextConfigBoundary, addPagesSurfacePlans };
