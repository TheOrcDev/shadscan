import path from "node:path";
import {
  type CompilerOptions,
  canHaveModifiers,
  type ExportAssignment,
  type ExportDeclaration,
  type Expression,
  type FunctionDeclaration,
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
import { type ParsedSourceFile, walkNodes } from "../ast";
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

const registerNestedComponents = (
  record: FileRecord,
  nodes: ComponentNodeRecord[],
  limits: ComponentRenderGraphLimits,
  graphBoundaryReasons: Set<string>
): void => {
  const registeredStarts = new Set(
    nodes
      .filter((node) => node.filePath === path.resolve(record.parsed.filePath))
      .map((node) => node.declarationStart)
  );

  walkNodes(record.parsed.sourceFile, (candidate) => {
    if (nodes.length >= limits.maxNodes) {
      return;
    }

    let declaration: SupportedFunction | null = null;
    let localName: string | null = null;

    if (
      isFunctionDeclaration(candidate) &&
      candidate.name &&
      !isSourceFile(candidate.parent)
    ) {
      declaration = candidate;
      localName = candidate.name.text;
    } else if (
      isVariableDeclaration(candidate) &&
      isIdentifier(candidate.name) &&
      candidate.initializer
    ) {
      declaration = getWrappedFunction(candidate.initializer);
      localName = declaration ? candidate.name.text : null;
    }

    if (
      !(
        declaration &&
        localName &&
        !registeredStarts.has(declaration.getStart(record.parsed.sourceFile))
      )
    ) {
      return;
    }

    const node = registerNode(
      record,
      nodes,
      declaration,
      localName,
      limits,
      graphBoundaryReasons
    );
    if (node) {
      registeredStarts.add(node.declarationStart);
    }
  });
};

const registerExportDeclaration = (
  record: FileRecord,
  statement: ExportDeclaration
): void => {
  if (!statement.exportClause) {
    record.hasExportStar = true;
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
  graphBoundaryReasons: Set<string>
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

  registerNestedComponents(record, nodes, limits, graphBoundaryReasons);
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
} => {
  const fileRecords = new Map<string, FileRecord>();
  const nodes: ComponentNodeRecord[] = [];

  for (const parsed of [...parsedFiles].sort((left, right) =>
    compareCodeUnits(path.resolve(left.filePath), path.resolve(right.filePath))
  )) {
    const record = createFileRecord(parsed);
    fileRecords.set(path.resolve(parsed.filePath), record);
    registerImports(record);
    registerSourceStatements(record, nodes, limits, graphBoundaryReasons);
  }

  addLocalExportNames(fileRecords, nodes);

  return { fileRecords, nodes };
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
  host: ConfinedTypeScriptHost
): CompilerOptions => {
  if (!project.paths.tsconfig) {
    return {};
  }

  return (
    getParsedCommandLineOfConfigFile(project.paths.tsconfig, {}, host)
      ?.options ?? {}
  );
};

const createGraphBuildState = (
  project: ProjectDiscovery,
  filesystemRoot: string,
  parsedFiles: ParsedSourceFile[],
  limits: ComponentRenderGraphLimits,
  graphBoundaryReasons: Set<string>
): { nodes: ComponentNodeRecord[]; state: GraphBuildState } => {
  const { fileRecords, nodes } = createFileRecords(
    parsedFiles,
    limits,
    graphBoundaryReasons
  );
  const host = createConfinedTypeScriptHost(filesystemRoot);
  const nodeRecords = new Map(nodes.map((node) => [node.id, node]));

  return {
    nodes,
    state: {
      compilerOptions: getCompilerOptions(project, host),
      edgeTraversalHalted: false,
      edges: [],
      fileRecords,
      graphBoundaryReasons,
      host,
      limits,
      metrics: {
        edgeTruncationMarkers: 0,
        navigationReachabilityEvaluations: 0,
        surfaceCandidatesVisited: 0,
        surfacePlansCreated: 0,
        templateNodesVisited: 0,
      },
      navigationReachability: new Map(),
      navigationReachabilityInitialized: false,
      nodeRecords,
      project,
      surfacePlanningHalted: false,
    },
  };
};

export { createGraphBuildState, getEdgeId, getGuard, getSourceCandidate };
