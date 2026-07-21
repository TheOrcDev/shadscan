import path from "node:path";
import {
  type Block,
  type CallExpression,
  type Expression,
  type IfStatement,
  isArrowFunction,
  isBlock,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isJsxElement,
  isJsxExpression,
  isJsxFragment,
  isJsxSelfClosingElement,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isVariableDeclaration,
  isVariableStatement,
  type JsxChild,
  type JsxOpeningLikeElement,
  type Node,
  type Statement,
  SyntaxKind,
} from "typescript";
import { getJsxTagName, walkNodes } from "../ast";
import { getResponsiveVisibility } from "../rules/responsive-visibility";
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

const INTRINSIC_ELEMENT_PATTERN = /^[a-z]/;
const CLIENT_ENTRY_FILE_PATTERN = /^main\.[cm]?[jt]sx?$/;
const HTML_MODULE_ENTRY_PATTERN =
  /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["'][^>]*>/i;
const LEADING_SLASH_PATTERN = /^\//;

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

  walkNodes(record.parsed.sourceFile, (node) => {
    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.initializer &&
      isCreateRootCall(node.initializer, record)
    ) {
      bindings.add(node.name.text);
    }
  });

  return bindings;
};

const getRenderArgument = (
  node: CallExpression,
  record: FileRecord,
  rootBindings: Set<string>
): Expression | null => {
  if (isIdentifier(node.expression)) {
    if (isImportedReactDomMember(record, node.expression.text, "render")) {
      return node.arguments[0] ?? null;
    }
    if (isImportedReactDomMember(record, node.expression.text, "hydrateRoot")) {
      return node.arguments[1] ?? null;
    }
    return null;
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

  if (
    node.expression.name.text === "hydrateRoot" &&
    isIdentifier(receiver) &&
    isReactDomNamespace(record, receiver.text)
  ) {
    return node.arguments[1] ?? null;
  }

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

const hasVisibilityAttributes = (opening: JsxOpeningLikeElement): boolean =>
  getResponsiveVisibility(opening).bands.some((band) => band !== "visible");

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

  if (hasVisibilityAttributes(opening)) {
    boundaryReasons.push(
      `Rendered client wrapper ${tagName} has attributes whose visibility could not be projected onto its children.`
    );
  }

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

const getRenderArguments = (
  record: FileRecord,
  boundaryReasons: string[]
): Expression[] => {
  const argumentsInOrder: { expression: Expression; start: number }[] = [];
  const rootBindings = getCreateRootBindings(record);
  const functions = new Map<string, Block>();
  const activeFunctions = new Set<string>();

  for (const statement of record.parsed.sourceFile.statements) {
    if (isFunctionDeclaration(statement) && statement.name) {
      if (statement.body) {
        functions.set(statement.name.text, statement.body);
      }
    } else if (isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          isIdentifier(declaration.name) &&
          declaration.initializer &&
          (isArrowFunction(declaration.initializer) ||
            isFunctionExpression(declaration.initializer)) &&
          isBlock(declaration.initializer.body)
        ) {
          functions.set(declaration.name.text, declaration.initializer.body);
        }
      }
    }
  }

  const scanNode = (node: Node): void => {
    if (
      isFunctionDeclaration(node) ||
      isArrowFunction(node) ||
      isFunctionExpression(node)
    ) {
      return;
    }
    if (!isCallExpression(node)) {
      node.forEachChild(scanNode);
      return;
    }

    const argument = getRenderArgument(node, record, rootBindings);
    if (argument) {
      argumentsInOrder.push({
        expression: argument,
        start: node.getStart(record.parsed.sourceFile),
      });
    } else if (
      isPropertyAccessExpression(node.expression) &&
      ["render", "hydrateRoot"].includes(node.expression.name.text)
    ) {
      boundaryReasons.push(
        "A reachable mount-like client call could not be safely composed."
      );
    }

    if (isIdentifier(node.expression)) {
      const helper = functions.get(node.expression.text);
      if (helper && !activeFunctions.has(node.expression.text)) {
        activeFunctions.add(node.expression.text);
        scanStatements(helper);
        activeFunctions.delete(node.expression.text);
      }
    }

    node.forEachChild(scanNode);
  };

  const scanIf = (statement: IfStatement): void => {
    if (statement.expression.kind === SyntaxKind.TrueKeyword) {
      scanStatement(statement.thenStatement);
      return;
    }
    if (statement.expression.kind === SyntaxKind.FalseKeyword) {
      if (statement.elseStatement) {
        scanStatement(statement.elseStatement);
      }
      return;
    }
    const before = argumentsInOrder.length;
    scanStatement(statement.thenStatement);
    const thenArguments = argumentsInOrder.splice(before);
    if (statement.elseStatement) {
      scanStatement(statement.elseStatement);
    }
    const elseArguments = argumentsInOrder.splice(before);

    if (thenArguments.length > 0 && elseArguments.length > 0) {
      boundaryReasons.push(
        "Mutually exclusive client mount branches could not be represented as simultaneous roots."
      );
      return;
    }
    argumentsInOrder.push(...thenArguments, ...elseArguments);
  };

  const scanStatement = (statement: Statement): void => {
    if (isFunctionDeclaration(statement)) {
      return;
    }
    if (isBlock(statement)) {
      scanStatements(statement);
      return;
    }
    if (isIfStatement(statement)) {
      scanIf(statement);
      return;
    }
    scanNode(statement);
  };

  const scanStatements = (block: Block): void => {
    for (const statement of block.statements) {
      scanStatement(statement);
    }
  };

  for (const statement of record.parsed.sourceFile.statements) {
    scanStatement(statement);
  }

  return argumentsInOrder
    .sort((left, right) => left.start - right.start)
    .map(({ expression }) => expression);
};

const getAppRootNode = (
  record: FileRecord,
  state: GraphBuildState
): ComponentNodeRecord | null =>
  getRecordDefault(record, state) ?? getRecordNamed(record, "App", state);

const getHtmlEntryPath = (state: GraphBuildState): string | null => {
  const html = state.host.readFile(
    path.join(state.project.rootDir, "index.html")
  );
  const source = html?.match(HTML_MODULE_ENTRY_PATTERN)?.[1];
  return source
    ? path.resolve(
        state.project.rootDir,
        source.replace(LEADING_SLASH_PATTERN, "")
      )
    : null;
};

const getClientEntryPaths = (state: GraphBuildState): string[] => {
  const htmlEntry = getHtmlEntryPath(state);
  const discoveredEntry = state.project.paths.viteEntry;
  const selectedEntry =
    htmlEntry ??
    (discoveredEntry &&
    CLIENT_ENTRY_FILE_PATTERN.test(path.basename(discoveredEntry))
      ? discoveredEntry
      : null);
  if (selectedEntry) {
    return [selectedEntry];
  }

  return [
    path.join(state.project.rootDir, "src", "main.tsx"),
    path.join(state.project.rootDir, "src", "main.jsx"),
    path.join(state.project.rootDir, "src", "main.ts"),
    path.join(state.project.rootDir, "src", "main.js"),
    path.join(state.project.rootDir, "main.tsx"),
    path.join(state.project.rootDir, "main.jsx"),
    path.join(state.project.rootDir, "main.ts"),
    path.join(state.project.rootDir, "main.js"),
  ];
};

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
    for (const argument of getRenderArguments(record, boundaryReasons)) {
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
