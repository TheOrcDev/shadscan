import path from "node:path";
import {
  type Expression,
  isArrowFunction,
  isBinaryExpression,
  isIdentifier,
  isJsxElement,
  isJsxSelfClosingElement,
  isPropertyAccessExpression,
  SyntaxKind,
} from "typescript";
import { walkNodes } from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import { addSurfacePlan } from "./surface-plan-budget";
import { getRecordDefault, resolveElementTarget } from "./symbol-resolution";
import type {
  ComponentSeed,
  FileRecord,
  GraphBuildState,
  SurfacePlan,
} from "./types";

const PAGE_FILE_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/;
// The default page resolvers reference ./pages or ./Pages globs; anything
// else means page resolution is customized and surfaces may be incomplete.
const DEFAULT_PAGES_GLOB_PATTERN = /["'`]\.\/(?:pages|Pages)\//;
const CREATE_INERTIA_APP_PATTERN = /\bcreateInertiaApp\s*\(/;

const getInertiaAppRecord = (state: GraphBuildState): FileRecord | null => {
  for (const candidate of [
    "resources/js/app.tsx",
    "resources/js/app.jsx",
    "resources/js/app.ts",
    "resources/js/app.js",
  ]) {
    const record = state.fileRecords.get(
      path.resolve(state.project.rootDir, candidate)
    );

    if (record) {
      return record;
    }
  }

  return null;
};

const getLayoutExpression = (
  record: FileRecord
): { expression: Expression; kind: "component" | "render" } | null => {
  let layout: { expression: Expression; kind: "component" | "render" } | null =
    null;

  // Persistent layouts are assigned as `Page.layout = …` on the page module.
  walkNodes(record.parsed.sourceFile, (node) => {
    if (layout || !isBinaryExpression(node)) {
      return;
    }

    if (
      node.operatorToken.kind !== SyntaxKind.EqualsToken ||
      !isPropertyAccessExpression(node.left) ||
      node.left.name.text !== "layout"
    ) {
      return;
    }

    if (isIdentifier(node.right)) {
      layout = { expression: node.right, kind: "component" };
      return;
    }

    if (isArrowFunction(node.right)) {
      layout = { expression: node.right, kind: "render" };
    }
  });

  return layout;
};

const getRenderedLayoutName = (expression: Expression): string | null => {
  // `(page) => <Layout>{page}</Layout>` — take the outermost rendered tag.
  if (!isArrowFunction(expression)) {
    return null;
  }

  let tagName: string | null = null;

  walkNodes(expression, (node) => {
    if (tagName) {
      return;
    }

    if (isJsxElement(node)) {
      tagName = node.openingElement.tagName.getText();
    } else if (isJsxSelfClosingElement(node)) {
      tagName = node.tagName.getText();
    }
  });

  return tagName;
};

const wrapSeedWithPersistentLayout = (
  pageSeed: ComponentSeed,
  record: FileRecord,
  state: GraphBuildState,
  boundaryReasons: string[]
): ComponentSeed => {
  const layout = getLayoutExpression(record);

  if (!layout) {
    return pageSeed;
  }

  const layoutName =
    layout.kind === "component" && isIdentifier(layout.expression)
      ? layout.expression.text
      : getRenderedLayoutName(layout.expression);

  if (!layoutName) {
    boundaryReasons.push(
      "The Inertia persistent layout expression could not be statically resolved."
    );
    return pageSeed;
  }

  const resolved = resolveElementTarget(record, layoutName, state);

  if (!resolved.target) {
    boundaryReasons.push(
      resolved.boundaryReason ??
        `The Inertia persistent layout ${layoutName} could not be resolved.`
    );
    return pageSeed;
  }

  return {
    componentId: resolved.target.id,
    projectedChildren: { kind: "component", seed: pageSeed },
  };
};

const hasNonDefaultPagesGlob = (appRecord: FileRecord): boolean => {
  const content = appRecord.parsed.content;

  if (!CREATE_INERTIA_APP_PATTERN.test(content)) {
    return false;
  }

  // A default setup references ./pages or ./Pages somewhere in the resolver
  // (import.meta.glob, resolvePageComponent, or a template import).
  return !DEFAULT_PAGES_GLOB_PATTERN.test(content);
};

const addInertiaSurfacePlans = (
  state: GraphBuildState,
  plans: SurfacePlan[]
): void => {
  const pagesDir = state.project.paths.inertiaPagesDir;

  if (!pagesDir || state.surfacePlanningHalted) {
    return;
  }

  const appRecord = getInertiaAppRecord(state);

  if (appRecord && hasNonDefaultPagesGlob(appRecord)) {
    state.graphBoundaryReasons.add(
      "Inertia page resolution uses a non-default glob; surfaces may be incomplete."
    );
  }

  const resolvedPagesDir = path.resolve(pagesDir);
  const pageRecords = [...state.fileRecords.values()]
    .filter((record) =>
      path
        .resolve(record.parsed.filePath)
        .startsWith(`${resolvedPagesDir}${path.sep}`)
    )
    .sort((left, right) =>
      compareCodeUnits(left.parsed.filePath, right.parsed.filePath)
    );

  for (const record of pageRecords) {
    const boundaryReasons: string[] = [];
    const pageNode = getRecordDefault(record, state);
    const routeKey = path
      .relative(pagesDir, record.parsed.filePath)
      .replace(PAGE_FILE_EXTENSION_PATTERN, "")
      .split(path.sep)
      .join("/");

    if (!pageNode) {
      boundaryReasons.push(
        "The Inertia page has no resolvable default component export."
      );
    }

    const roots = pageNode
      ? [
          wrapSeedWithPersistentLayout(
            { componentId: pageNode.id, projectedChildren: null },
            record,
            state,
            boundaryReasons
          ),
        ]
      : [];

    const added = addSurfacePlan(state, plans, {
      adapter: "laravel-inertia-react",
      boundaryReasons,
      dynamicComponent: null,
      id: `inertia:${routeKey}`,
      roots,
      routeKey,
    });

    if (!added) {
      return;
    }
  }
};

export { addInertiaSurfacePlans };
