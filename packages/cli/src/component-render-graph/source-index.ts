import path from "node:path";
import {
  type CompilerOptions,
  canHaveModifiers,
  type ExportAssignment,
  type ExportDeclaration,
  type Expression,
  type FunctionDeclaration,
  forEachChild,
  getModifiers,
  getParsedCommandLineOfConfigFile,
  isArrowFunction,
  isCallExpression,
  isExportAssignment,
  isExportDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isPropertyAccessExpression,
  isSourceFile,
  isStringLiteral,
  isVariableDeclaration,
  isVariableStatement,
  type Node,
  SyntaxKind,
  type VariableStatement,
} from "typescript";
import type { ParsedSourceFile } from "../ast";
import { compareCodeUnits } from "../deterministic-order";
import type { ProjectDiscovery } from "../discovery";
import {
  type ConfinedTypeScriptHost,
  createConfinedTypeScriptHost,
} from "../typescript-host";
import { getChildrenBindings, getPropBindings } from "./component-properties";
import { MODULE_CANDIDATE_SUFFIXES } from "./constants";
import { subtreeHasPotentialNavigation } from "./navigation-syntax";
import type {
  ComponentId,
  ComponentNodeRecord,
  ComponentRenderGraphLimits,
  FileRecord,
  GraphBuildState,
  RenderGuard,
  SupportedFunction,
} from "./types";
import { getViteAliases } from "./vite-aliases";

const getComponentId = (
  filePath: string,
  declarationStart: number
): ComponentId => JSON.stringify([path.resolve(filePath), declarationStart]);

const getEdgeId = (ownerId: ComponentId, callsiteStart: number): string =>
  JSON.stringify([ownerId, callsiteStart]);

const getGuard = (
  file: ParsedSourceFile,
  condition: Node,
  branch: RenderGuard["branch"]
): RenderGuard => ({
  branch,
  id: JSON.stringify([
    path.resolve(file.filePath),
    condition.getStart(file.sourceFile),
  ]),
});

const hasModifier = (node: Node, kind: SyntaxKind): boolean =>
  canHaveModifiers(node) &&
  (getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);

const isSupportedFunction = (node: Node): node is SupportedFunction =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node);

const COMPONENT_WRAPPERS = new Set(["forwardRef", "memo"]);

const getWrappedFunction = (
  expression: Expression
): SupportedFunction | null => {
  if (isSupportedFunction(expression)) {
    return expression;
  }

  if (!isCallExpression(expression)) {
    return null;
  }

  let wrapperName: string | null = null;
  if (isIdentifier(expression.expression)) {
    wrapperName = expression.expression.text;
  } else if (isPropertyAccessExpression(expression.expression)) {
    wrapperName = expression.expression.name.text;
  }
  const wrapped = expression.arguments[0];

  if (!(wrapperName && COMPONENT_WRAPPERS.has(wrapperName) && wrapped)) {
    return null;
  }

  return isSupportedFunction(wrapped) ? wrapped : null;
};

const hasBody = (
  declaration: SupportedFunction
): declaration is SupportedFunction & { body: Node } =>
  Boolean(declaration.body);

const addMapValue = <Value>(
  map: Map<string, Value[]>,
  key: string,
  value: Value
): void => {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
};

const createNodeRecord = (
  file: ParsedSourceFile,
  declaration: SupportedFunction,
  localName: string | null
): ComponentNodeRecord => {
  const declarationStart = declaration.getStart(file.sourceFile);
  const childrenBindings = getChildrenBindings(declaration);

  return {
    childrenBindings,
    childrenProjection: "ignored",
    classNameBindings: getPropBindings(declaration, "className"),
    classNameForwarding: "ignored",
    declaration,
    declarationStart,
    exportNames: [],
    file,
    filePath: path.resolve(file.filePath),
    id: getComponentId(file.filePath, declarationStart),
    localName,
    projectsChildren: false,
    template: [],
  };
};

const registerNode = (
  record: FileRecord,
  nodes: ComponentNodeRecord[],
  declaration: SupportedFunction,
  localName: string | null,
  limits: ComponentRenderGraphLimits,
  graphBoundaryReasons: Set<string>
): ComponentNodeRecord | null => {
  if (!hasBody(declaration)) {
    return null;
  }

  if (nodes.length >= limits.maxNodes) {
    graphBoundaryReasons.add(
      `Component graph node limit (${limits.maxNodes}) was reached.`
    );
    return null;
  }

  const node = createNodeRecord(record.parsed, declaration, localName);
  nodes.push(node);

  if (localName) {
    addMapValue(record.localComponents, localName, node.id);
  }

  return node;
};

const addComponentExport = (
  record: FileRecord,
  node: ComponentNodeRecord,
  exportName: string
): void => {
  addMapValue(record.exportReferences, exportName, {
    componentId: node.id,
    kind: "component",
  });

  if (!node.exportNames.includes(exportName)) {
    node.exportNames.push(exportName);
  }
};

const registerFunctionStatement = (
  record: FileRecord,
  nodes: ComponentNodeRecord[],
  declaration: FunctionDeclaration,
  limits: ComponentRenderGraphLimits,
  graphBoundaryReasons: Set<string>
): void => {
  const node = registerNode(
    record,
    nodes,
    declaration,
    declaration.name?.text ?? null,
    limits,
    graphBoundaryReasons
  );

  if (!node) {
    return;
  }

  if (hasModifier(declaration, SyntaxKind.DefaultKeyword)) {
    addComponentExport(record, node, "default");
  }

  if (
    declaration.name &&
    hasModifier(declaration, SyntaxKind.ExportKeyword) &&
    !hasModifier(declaration, SyntaxKind.DefaultKeyword)
  ) {
    addComponentExport(record, node, declaration.name.text);
  }
};

const registerVariableStatement = (
  record: FileRecord,
  nodes: ComponentNodeRecord[],
  statement: VariableStatement,
  limits: ComponentRenderGraphLimits,
  graphBoundaryReasons: Set<string>
): void => {
  for (const declaration of statement.declarationList.declarations) {
    const component = declaration.initializer
      ? getWrappedFunction(declaration.initializer)
      : null;

    if (!(isIdentifier(declaration.name) && component)) {
      continue;
    }

    const node = registerNode(
      record,
      nodes,
      component,
      declaration.name.text,
      limits,
      graphBoundaryReasons
    );

    if (node && hasModifier(statement, SyntaxKind.ExportKeyword)) {
      addComponentExport(record, node, declaration.name.text);
    }
  }
};

const registerExportAssignment = (
  record: FileRecord,
  nodes: ComponentNodeRecord[],
  statement: ExportAssignment,
  limits: ComponentRenderGraphLimits,
  graphBoundaryReasons: Set<string>
): void => {
  const component = getWrappedFunction(statement.expression);

  if (component) {
    const node = registerNode(
      record,
      nodes,
      component,
      null,
      limits,
      graphBoundaryReasons
    );

    if (node) {
      addComponentExport(record, node, "default");
    }
    return;
  }

  if (isIdentifier(statement.expression)) {
    addMapValue(record.exportReferences, "default", {
      kind: "local",
      localName: statement.expression.text,
    });
  }
};

interface NestedComponent {
  declaration: SupportedFunction;
  localName: string;
}

interface SourceIndexAstBudget {
  limit: number;
  used: number;
}

const SOURCE_INDEX_AST_VISITS_PER_COMPONENT = 64;

const appendChildNodes = (
  candidate: Node,
  pending: Node[],
  budget: SourceIndexAstBudget
): boolean => {
  const children: Node[] = [];
  const stoppedAt = forEachChild(candidate, (child) => {
    budget.used += 1;
    if (budget.used >= budget.limit) {
      return child;
    }

    children.push(child);
  });

  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child) {
      pending.push(child);
    }
  }

  return Boolean(stoppedAt);
};

const getNestedComponent = (candidate: Node): NestedComponent | null => {
  if (
    isFunctionDeclaration(candidate) &&
    candidate.name &&
    !isSourceFile(candidate.parent)
  ) {
    return { declaration: candidate, localName: candidate.name.text };
  }

  if (
    !(
      isVariableDeclaration(candidate) &&
      isIdentifier(candidate.name) &&
      candidate.initializer
    )
  ) {
    return null;
  }

  const declaration = getWrappedFunction(candidate.initializer);
  return declaration ? { declaration, localName: candidate.name.text } : null;
};

const registerNestedComponents = (
  record: FileRecord,
  nodes: ComponentNodeRecord[],
  limits: ComponentRenderGraphLimits,
  graphBoundaryReasons: Set<string>,
  astBudget: SourceIndexAstBudget
): void => {
  const registeredStarts = new Set(
    nodes
      .filter((node) => node.filePath === path.resolve(record.parsed.filePath))
      .map((node) => node.declarationStart)
  );

  if (astBudget.used >= astBudget.limit) {
    graphBoundaryReasons.add(
      `Component source-index AST visit limit (${astBudget.limit}) was reached.`
    );
    return;
  }

  const pending: Node[] = [record.parsed.sourceFile];
  astBudget.used += 1;

  while (
    pending.length > 0 &&
    nodes.length < limits.maxNodes &&
    astBudget.used <= astBudget.limit
  ) {
    const candidate = pending.pop();
    if (!candidate) {
      break;
    }

    const enumerationHalted = appendChildNodes(candidate, pending, astBudget);
    if (enumerationHalted) {
      graphBoundaryReasons.add(
        `Component source-index AST visit limit (${astBudget.limit}) was reached.`
      );
      break;
    }
    const nestedComponent = getNestedComponent(candidate);

    if (
      !(
        nestedComponent &&
        !registeredStarts.has(
          nestedComponent.declaration.getStart(record.parsed.sourceFile)
        )
      )
    ) {
      continue;
    }

    const node = registerNode(
      record,
      nodes,
      nestedComponent.declaration,
      nestedComponent.localName,
      limits,
      graphBoundaryReasons
    );
    if (node) {
      registeredStarts.add(node.declarationStart);
    }
  }

  if (pending.length > 0 && nodes.length >= limits.maxNodes) {
    graphBoundaryReasons.add(
      `Component graph node limit (${limits.maxNodes}) halted nested declaration indexing.`
    );
  }
};

const registerExportDeclaration = (
  record: FileRecord,
  statement: ExportDeclaration
): void => {
  if (!statement.exportClause) {
    record.hasExportStar = true;
    if (
      statement.moduleSpecifier &&
      isStringLiteral(statement.moduleSpecifier)
    ) {
      addMapValue(record.exportReferences, "*", {
        importedName: "*",
        kind: "reexport",
        moduleName: statement.moduleSpecifier.text,
      });
    }
    return;
  }

  if (!isNamedExports(statement.exportClause)) {
    return;
  }

  const moduleName =
    statement.moduleSpecifier && isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : null;

  for (const element of statement.exportClause.elements) {
    const exportName = element.name.text;
    const importedName = element.propertyName?.text ?? element.name.text;

    addMapValue(
      record.exportReferences,
      exportName,
      moduleName
        ? { importedName, kind: "reexport", moduleName }
        : { kind: "local", localName: importedName }
    );
  }
};

const registerImports = (record: FileRecord): void => {
  for (const statement of record.parsed.sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        !statement.importClause?.isTypeOnly
      )
    ) {
      continue;
    }

    const moduleName = statement.moduleSpecifier.text;
    const importClause = statement.importClause;

    if (importClause?.name) {
      record.imports.set(importClause.name.text, {
        importedName: "default",
        kind: "binding",
        moduleName,
      });
    }

    const namedBindings = importClause?.namedBindings;

    if (namedBindings && isNamespaceImport(namedBindings)) {
      record.imports.set(namedBindings.name.text, {
        importedName: null,
        kind: "namespace",
        moduleName,
      });
    } else if (namedBindings && isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        if (element.isTypeOnly) {
          continue;
        }

        record.imports.set(element.name.text, {
          importedName: element.propertyName?.text ?? element.name.text,
          kind: "binding",
          moduleName,
        });
      }
    }
  }
};

const createFileRecord = (parsed: ParsedSourceFile): FileRecord => ({
  exportReferences: new Map(),
  hasExportStar: false,
  imports: new Map(),
  localComponents: new Map(),
  parsed,
  potentialNavigation: subtreeHasPotentialNavigation(parsed.sourceFile),
});

const registerSourceStatements = (
  record: FileRecord,
  nodes: ComponentNodeRecord[],
  limits: ComponentRenderGraphLimits,
  graphBoundaryReasons: Set<string>,
  astBudget: SourceIndexAstBudget
): void => {
  for (const statement of record.parsed.sourceFile.statements) {
    if (isFunctionDeclaration(statement)) {
      registerFunctionStatement(
        record,
        nodes,
        statement,
        limits,
        graphBoundaryReasons
      );
    } else if (isVariableStatement(statement)) {
      registerVariableStatement(
        record,
        nodes,
        statement,
        limits,
        graphBoundaryReasons
      );
    } else if (isExportAssignment(statement)) {
      registerExportAssignment(
        record,
        nodes,
        statement,
        limits,
        graphBoundaryReasons
      );
    } else if (isExportDeclaration(statement)) {
      registerExportDeclaration(record, statement);
    }
  }

  registerNestedComponents(
    record,
    nodes,
    limits,
    graphBoundaryReasons,
    astBudget
  );
};

const addLocalExportNames = (
  fileRecords: Map<string, FileRecord>,
  nodes: ComponentNodeRecord[]
): void => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const record of fileRecords.values()) {
    for (const [exportName, references] of record.exportReferences) {
      const reference = references.length === 1 ? references[0] : null;
      if (reference?.kind !== "local") {
        continue;
      }

      const componentIds = record.localComponents.get(reference.localName);
      const node =
        componentIds?.length === 1
          ? nodesById.get(componentIds[0] ?? "")
          : null;
      if (node && !node.exportNames.includes(exportName)) {
        node.exportNames.push(exportName);
      }
    }
  }
};

const createFileRecords = (
  parsedFiles: ParsedSourceFile[],
  limits: ComponentRenderGraphLimits,
  graphBoundaryReasons: Set<string>
): {
  fileRecords: Map<string, FileRecord>;
  nodes: ComponentNodeRecord[];
  sourceIndexNodesVisited: number;
} => {
  const fileRecords = new Map<string, FileRecord>();
  const nodes: ComponentNodeRecord[] = [];
  const astBudget: SourceIndexAstBudget = {
    limit: Math.max(1, limits.maxNodes) * SOURCE_INDEX_AST_VISITS_PER_COMPONENT,
    used: 0,
  };

  for (const parsed of [...parsedFiles].sort((left, right) =>
    compareCodeUnits(path.resolve(left.filePath), path.resolve(right.filePath))
  )) {
    const record = createFileRecord(parsed);
    fileRecords.set(path.resolve(parsed.filePath), record);
    registerImports(record);
    registerSourceStatements(
      record,
      nodes,
      limits,
      graphBoundaryReasons,
      astBudget
    );
  }

  addLocalExportNames(fileRecords, nodes);

  return {
    fileRecords,
    nodes,
    sourceIndexNodesVisited: astBudget.used,
  };
};

const getSourceCandidate = (
  candidatePath: string,
  fileRecords: Map<string, FileRecord>
): FileRecord | null => {
  for (const suffix of MODULE_CANDIDATE_SUFFIXES) {
    const record = fileRecords.get(path.resolve(`${candidatePath}${suffix}`));

    if (record) {
      return record;
    }
  }

  return null;
};

const getCompilerOptions = (
  project: ProjectDiscovery,
  host: ConfinedTypeScriptHost,
  parsedFiles: ParsedSourceFile[],
  graphBoundaryReasons: Set<string>
): CompilerOptions => {
  const configuredOptions = project.paths.tsconfig
    ? (getParsedCommandLineOfConfigFile(project.paths.tsconfig, {}, host)
        ?.options ?? {})
    : {};
  const viteAliasResult = getViteAliases(parsedFiles);
  if (viteAliasResult.partial) {
    graphBoundaryReasons.add(
      "Vite resolve.alias configuration could not be read statically; local alias imports may be unresolved."
    );
  }
  if (viteAliasResult.aliases.size === 0) {
    return configuredOptions;
  }

  const aliasPaths: Record<string, string[]> = {};
  for (const [alias, target] of viteAliasResult.aliases) {
    aliasPaths[alias] = [target];
    aliasPaths[`${alias}/*`] = [`${target}/*`];
  }

  return {
    ...configuredOptions,
    baseUrl: configuredOptions.baseUrl ?? project.rootDir,
    paths: { ...aliasPaths, ...configuredOptions.paths },
  };
};

const createGraphBuildState = (
  project: ProjectDiscovery,
  filesystemRoot: string,
  parsedFiles: ParsedSourceFile[],
  limits: ComponentRenderGraphLimits,
  graphBoundaryReasons: Set<string>
): { nodes: ComponentNodeRecord[]; state: GraphBuildState } => {
  const { fileRecords, nodes, sourceIndexNodesVisited } = createFileRecords(
    parsedFiles,
    limits,
    graphBoundaryReasons
  );
  const host = createConfinedTypeScriptHost(filesystemRoot);
  const nodeRecords = new Map(nodes.map((node) => [node.id, node]));
  const metrics = {
    edgeTruncationMarkers: 0,
    navigationReachabilityEvaluations: 0,
    sourceIndexNodesVisited,
    surfaceCandidatesVisited: 0,
    surfacePlansCreated: 0,
    templateNodesVisited: 0,
  };

  return {
    nodes,
    state: {
      compilerOptions: getCompilerOptions(
        project,
        host,
        parsedFiles,
        graphBoundaryReasons
      ),
      edgeTraversalHalted: false,
      edges: [],
      fileRecords,
      graphBoundaryReasons,
      host,
      limits,
      metrics,
      navigationReachability: new Map(),
      navigationReachabilityInitialized: false,
      nodeRecords,
      project,
      surfacePlanningHalted: false,
    },
  };
};

export { createGraphBuildState, getEdgeId, getGuard, getSourceCandidate };
