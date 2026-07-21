import path from "node:path";
import {
  type CallExpression,
  type Expression,
  isCallExpression,
  isIdentifier,
  isJsxElement,
  isJsxExpression,
  isJsxFragment,
  isJsxSelfClosingElement,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isVariableStatement,
  type JsxChild,
  type JsxOpeningLikeElement,
  type Node,
} from "typescript";
import { getJsxTagName, walkNodes } from "../ast";
import { TRANSPARENT_ROOT_COMPONENTS } from "./constants";
import { addSurfacePlan } from "./surface-plan-budget";
import {
  getRecord,
  getRecordDefault,
  getRecordNamed,
  resolveElementTarget,
} from "./symbol-resolution";
import type {
  ComponentNodeRecord,
  ComponentSeed,
  FileRecord,
  GraphBuildState,
  SurfacePlan,
} from "./types";

const CLIENT_ENTRY_FILE_PATTERN = /^main\.[cm]?[jt]sx?$/;
const INTRINSIC_ELEMENT_PATTERN = /^[a-z]/;

const unwrapExpression = (expression: Expression): Expression => {
  let current = expression;

  while (isParenthesizedExpression(current)) {
    current = current.expression;
  }

  return current;
};

const isReactDomModule = (moduleName: string): boolean =>
  moduleName === "react-dom" || moduleName === "react-dom/client";

const isImportedReactDomMember = (
  record: FileRecord,
  localName: string,
  importedName: string
): boolean => {
  const binding = record.imports.get(localName);
  return Boolean(
    binding &&
      binding.kind === "binding" &&
      binding.importedName === importedName &&
      isReactDomModule(binding.moduleName)
  );
};

const isReactDomNamespace = (
  record: FileRecord,
  localName: string
): boolean => {
  const binding = record.imports.get(localName);
  return Boolean(
    binding &&
      binding.kind === "namespace" &&
      isReactDomModule(binding.moduleName)
  );
};

const isCreateRootCall = (
  node: Node,
  record: FileRecord
): node is CallExpression => {
  if (!isCallExpression(node)) {
    return false;
  }

  if (isIdentifier(node.expression)) {
    return isImportedReactDomMember(record, node.expression.text, "createRoot");
  }

  return (
    isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "createRoot" &&
    isIdentifier(node.expression.expression) &&
    isReactDomNamespace(record, node.expression.expression.text)
  );
};

const getCreateRootBindings = (record: FileRecord): Set<string> => {
  const bindings = new Set<string>();

  for (const statement of record.parsed.sourceFile.statements) {
    if (!isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (
        isIdentifier(declaration.name) &&
        declaration.initializer &&
        isCreateRootCall(declaration.initializer, record)
      ) {
        bindings.add(declaration.name.text);
      }
    }
  }

  return bindings;
};

const getRenderArgument = (
  node: CallExpression,
  record: FileRecord,
  rootBindings: Set<string>
): Expression | null => {
  if (isIdentifier(node.expression)) {
    return isImportedReactDomMember(record, node.expression.text, "render")
      ? (node.arguments[0] ?? null)
      : null;
  }

  if (!isPropertyAccessExpression(node.expression)) {
    return null;
  }

  const receiver = node.expression.expression;
  const isRootRender =
    node.expression.name.text === "render" &&
    ((isIdentifier(receiver) && rootBindings.has(receiver.text)) ||
      isCreateRootCall(receiver, record));
  const isLegacyRender =
    node.expression.name.text === "render" &&
    isIdentifier(receiver) &&
    isReactDomNamespace(record, receiver.text);

  return isRootRender || isLegacyRender ? (node.arguments[0] ?? null) : null;
};

const getRenderedChildren = (children: readonly JsxChild[]): Expression[] => {
  const expressions: Expression[] = [];

  for (const child of children) {
    if (isJsxElement(child) || isJsxSelfClosingElement(child)) {
      expressions.push(child);
    } else if (isJsxExpression(child) && child.expression) {
      expressions.push(child.expression);
    }
  }

  return expressions;
};

const getMountedSeeds = (
  expression: Expression,
  record: FileRecord,
  state: GraphBuildState,
  boundaryReasons: string[]
): ComponentSeed[] => {
  const rendered = unwrapExpression(expression);

  if (isJsxFragment(rendered)) {
    return getRenderedChildren(rendered.children).flatMap((child) =>
      getMountedSeeds(child, record, state, boundaryReasons)
    );
  }

  let opening: JsxOpeningLikeElement | null = null;
  if (isJsxElement(rendered)) {
    opening = rendered.openingElement;
  } else if (isJsxSelfClosingElement(rendered)) {
    opening = rendered;
  }
  const tagName = opening ? getJsxTagName(opening) : null;

  if (!(opening && tagName)) {
    boundaryReasons.push(
      "A rendered client entry expression could not be statically expanded."
    );
    return [];
  }

  const children = isJsxElement(rendered)
    ? getRenderedChildren(rendered.children)
    : [];

  if (
    TRANSPARENT_ROOT_COMPONENTS.has(tagName) ||
    INTRINSIC_ELEMENT_PATTERN.test(tagName)
  ) {
    return children.flatMap((child) =>
      getMountedSeeds(child, record, state, boundaryReasons)
    );
  }

  const target = resolveElementTarget(record, tagName, state);
  if (!target.target) {
    boundaryReasons.push(
      target.boundaryReason ??
        `The rendered client entry component ${tagName} is opaque.`
    );
    return [];
  }

  const childSeeds = children.flatMap((child) =>
    getMountedSeeds(child, record, state, boundaryReasons)
  );
  if (childSeeds.length > 1) {
    boundaryReasons.push(
      `Rendered client wrapper ${tagName} has multiple children that could not be projected as one ordered template.`
    );
  }

  return [
    {
      componentId: target.target.id,
      projectedChildren:
        childSeeds.length === 1 && childSeeds[0]
          ? { kind: "component", seed: childSeeds[0] }
          : null,
    },
  ];
};

const getRenderArguments = (record: FileRecord): Expression[] => {
  const argumentsInOrder: { expression: Expression; start: number }[] = [];
  const rootBindings = getCreateRootBindings(record);

  walkNodes(record.parsed.sourceFile, (node) => {
    if (!isCallExpression(node)) {
      return;
    }

    const argument = getRenderArgument(node, record, rootBindings);
    if (argument) {
      argumentsInOrder.push({
        expression: argument,
        start: node.getStart(record.parsed.sourceFile),
      });
    }
  });

  return argumentsInOrder
    .sort((left, right) => left.start - right.start)
    .map(({ expression }) => expression);
};

const getAppRootNode = (
  record: FileRecord,
  state: GraphBuildState
): ComponentNodeRecord | null =>
  getRecordDefault(record, state) ?? getRecordNamed(record, "App", state);

const getClientEntryPaths = (state: GraphBuildState): string[] =>
  [
    state.project.paths.viteEntry &&
    CLIENT_ENTRY_FILE_PATTERN.test(path.basename(state.project.paths.viteEntry))
      ? state.project.paths.viteEntry
      : null,
    path.join(state.project.rootDir, "src", "main.tsx"),
    path.join(state.project.rootDir, "src", "main.jsx"),
    path.join(state.project.rootDir, "src", "main.ts"),
    path.join(state.project.rootDir, "src", "main.js"),
    path.join(state.project.rootDir, "main.tsx"),
    path.join(state.project.rootDir, "main.jsx"),
    path.join(state.project.rootDir, "main.ts"),
    path.join(state.project.rootDir, "main.js"),
  ].filter((candidate): candidate is string => Boolean(candidate));

const getAppPaths = (state: GraphBuildState): string[] => [
  path.join(state.project.rootDir, "src", "App.tsx"),
  path.join(state.project.rootDir, "src", "App.jsx"),
  path.join(state.project.rootDir, "src", "App.ts"),
  path.join(state.project.rootDir, "src", "App.js"),
  path.join(state.project.rootDir, "App.tsx"),
  path.join(state.project.rootDir, "App.jsx"),
  path.join(state.project.rootDir, "App.ts"),
  path.join(state.project.rootDir, "App.js"),
];

const collectEntryRoots = (
  state: GraphBuildState,
  boundaryReasons: string[]
): { hasEntry: boolean; roots: ComponentSeed[] } => {
  const roots: ComponentSeed[] = [];
  let hasEntry = false;

  for (const entryPath of new Set(getClientEntryPaths(state))) {
    const record = getRecord(entryPath, state);
    if (!record) {
      continue;
    }

    hasEntry = true;
    for (const argument of getRenderArguments(record)) {
      roots.push(...getMountedSeeds(argument, record, state, boundaryReasons));
    }
  }

  return { hasEntry, roots };
};

const getFallbackAppRoot = (
  state: GraphBuildState
): ComponentNodeRecord | null => {
  for (const appPath of getAppPaths(state)) {
    const record = getRecord(appPath, state);
    const root = record ? getAppRootNode(record, state) : null;
    if (root) {
      return root;
    }
  }

  return null;
};

const addClientSurfacePlan = (
  state: GraphBuildState,
  plans: SurfacePlan[]
): void => {
  const adapter = state.project.framework.adapter;
  if (
    state.surfacePlanningHalted ||
    (adapter !== "vite-react" && adapter !== "generic-react")
  ) {
    return;
  }

  const boundaryReasons: string[] = [];
  const { hasEntry, roots } = collectEntryRoots(state, boundaryReasons);

  if (hasEntry && roots.length === 0) {
    boundaryReasons.push(
      "The existing client entry has no recognizable createRoot or render mount."
    );
  }

  if (!hasEntry) {
    const root = getFallbackAppRoot(state);
    if (root) {
      roots.push({ componentId: root.id, projectedChildren: null });
    }
  }

  if (!hasEntry && roots.length === 0) {
    boundaryReasons.push("No recognizable generic React root was found.");
  }

  addSurfacePlan(state, plans, {
    adapter,
    boundaryReasons,
    dynamicComponent: null,
    id: `${adapter}:document`,
    roots,
    routeKey: "/",
  });
};

export { addClientSurfacePlan };
