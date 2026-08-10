import path from "node:path";
import {
  type ArrowFunction,
  type BindingName,
  type CallExpression,
  canHaveModifiers,
  type Expression,
  type FunctionDeclaration,
  type FunctionExpression,
  forEachChild,
  getModifiers,
  isArrayBindingPattern,
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isCatchClause,
  isClassDeclaration,
  isComputedPropertyName,
  isElementAccessExpression,
  isExportDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isJsxSpreadAttribute,
  isMethodDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isOmittedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isStringLiteral,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  type MethodDeclaration,
  type Node,
  NodeFlags,
  type ObjectBindingPattern,
  SyntaxKind,
  type VariableDeclaration,
  type VariableDeclarationList,
} from "typescript";
import {
  findOwnedSourceScopes,
  getJsxTagName,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  type SourceScope,
  walkNodes,
} from "../ast";
import type { ProjectDiscovery } from "../discovery";
import {
  getProjectModuleResolver,
  resolveProjectModulePath,
} from "./module-resolution";

const FORM_PATTERN = /<form(?:\s|>)/;
const FORM_COMPONENT_NAME_PATTERN = /(?:^|\.)Form$/;
const KNOWN_RESOLVER_FACTORY_PATTERN = /^(?:valibot|yup|zod)Resolver$/;
const FORM_API_NAMES = new Set([
  "control",
  "formState",
  "handleSubmit",
  "register",
  "setError",
  "trigger",
]);
const MAX_FORM_ALIAS_HOPS = 32;
const MAX_FORM_HOOK_HOPS = 2;
const MAX_HOOK_CALLS_PER_SCOPE = 16;
const UNCERTAIN_RETURN_SELECTOR = Symbol("uncertain-return-selector");

interface ImportedBinding {
  importedName: string;
  moduleName: string;
}

interface FormHookProvider {
  scope: SourceScope;
  validation: FormValidationState;
}

interface ResolvedFormHookFlow {
  consumer: SourceScope;
  kind: "resolved";
  provider: FormHookProvider;
}

interface UncertainFormHookFlow {
  boundary: string;
  consumer: SourceScope;
  kind: "uncertain";
}

type FormHookFlow = ResolvedFormHookFlow | UncertainFormHookFlow;

interface FormHookAnalysis {
  directUseFormScopes: SourceScope[];
  flowsByConsumerKey: Map<string, FormHookFlow[]>;
  providerScopeKeys: Set<string>;
}

interface HookCallCandidate {
  call: CallExpression;
  returnSelector: ReturnSelector;
}

interface HookCallCollection {
  candidates: HookCallCandidate[];
  truncated: boolean;
}

interface ProviderEnvironment {
  filesByPath: Map<string, ParsedSourceFile>;
  project: ProjectDiscovery;
  resolver: ReturnType<typeof getProjectModuleResolver>;
}

interface ProviderResolutionContext extends ProviderEnvironment {
  consumer: SourceScope;
}

type SupportedFunction =
  | ArrowFunction
  | FunctionDeclaration
  | FunctionExpression;
type ScopeOwner = SupportedFunction | MethodDeclaration;
type FormValidationState = "absent" | "present" | "unknown";
type ReturnSelector = null | string | typeof UNCERTAIN_RETURN_SELECTOR;

interface FunctionDefinition {
  declaration: SupportedFunction;
  name: string;
}

interface OwnerBindingIndex {
  functionScoped: ReadonlySet<string>;
  lexicalByContainer: ReadonlyMap<Node, ReadonlySet<string>>;
}

interface ResolvedFunction {
  declaration: SupportedFunction;
  file: ParsedSourceFile;
}

const formHookAnalysisCache = new WeakMap<
  ProjectDiscovery,
  Map<string, Promise<FormHookAnalysis>>
>();
const ownerBindingCache = new WeakMap<ScopeOwner, OwnerBindingIndex>();
const topLevelFunctionDefinitionsCache = new WeakMap<
  ParsedSourceFile,
  readonly FunctionDefinition[]
>();

const getSourceScopeKey = (scope: SourceScope): string =>
  JSON.stringify([path.resolve(scope.file.filePath), scope.start, scope.end]);

const isScopeOwner = (node: Node): node is ScopeOwner =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node) ||
  isMethodDeclaration(node);

const getImportedBinding = (
  file: ParsedSourceFile,
  localName: string
): ImportedBinding | null => {
  const matches: ImportedBinding[] = [];

  for (const statement of file.sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier)
      )
    ) {
      continue;
    }

    const importClause = statement.importClause;

    if (importClause?.name?.text === localName) {
      matches.push({
        importedName: "default",
        moduleName: statement.moduleSpecifier.text,
      });
    }

    const namedBindings = importClause?.namedBindings;

    if (!(namedBindings && isNamedImports(namedBindings))) {
      continue;
    }

    for (const element of namedBindings.elements) {
      if (element.name.text === localName) {
        matches.push({
          importedName: element.propertyName?.text ?? element.name.text,
          moduleName: statement.moduleSpecifier.text,
        });
      }
    }
  }

  return matches.length === 1 ? (matches[0] ?? null) : null;
};

const getTopLevelFunctionDefinitions = (
  file: ParsedSourceFile
): readonly FunctionDefinition[] => {
  const cached = topLevelFunctionDefinitionsCache.get(file);

  if (cached) {
    return cached;
  }

  const definitions: FunctionDefinition[] = [];

  for (const statement of file.sourceFile.statements) {
    if (isFunctionDeclaration(statement) && statement.name) {
      definitions.push({ declaration: statement, name: statement.name.text });
      continue;
    }

    if (!isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (
        isIdentifier(declaration.name) &&
        declaration.initializer &&
        (isArrowFunction(declaration.initializer) ||
          isFunctionExpression(declaration.initializer))
      ) {
        definitions.push({
          declaration: declaration.initializer,
          name: declaration.name.text,
        });
      }
    }
  }

  topLevelFunctionDefinitionsCache.set(file, definitions);
  return definitions;
};

const getFunctionDefinition = (
  file: ParsedSourceFile,
  name: string
): SupportedFunction | null => {
  if (name === "default") {
    const defaultFunctions = file.sourceFile.statements.filter(
      (statement): statement is FunctionDeclaration =>
        isFunctionDeclaration(statement) &&
        Boolean(
          statement.modifiers?.some(
            (modifier) => modifier.kind === SyntaxKind.DefaultKeyword
          )
        )
    );

    return defaultFunctions.length === 1 ? (defaultFunctions[0] ?? null) : null;
  }

  const matches = getTopLevelFunctionDefinitions(file).filter(
    (definition) => definition.name === name
  );

  return matches.length === 1 ? (matches[0]?.declaration ?? null) : null;
};

const hasExportModifier = (node: Node): boolean =>
  Boolean(
    canHaveModifiers(node) &&
      getModifiers(node)?.some(
        (modifier) => modifier.kind === SyntaxKind.ExportKeyword
      )
  );

const getDirectExportedFunctionDefinitions = (
  file: ParsedSourceFile,
  exportedName: string
): SupportedFunction[] => {
  const matches: SupportedFunction[] = [];

  for (const statement of file.sourceFile.statements) {
    if (
      isFunctionDeclaration(statement) &&
      statement.name?.text === exportedName &&
      hasExportModifier(statement)
    ) {
      matches.push(statement);
      continue;
    }

    if (!(isVariableStatement(statement) && hasExportModifier(statement))) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (
        isIdentifier(declaration.name) &&
        declaration.name.text === exportedName &&
        declaration.initializer &&
        (isArrowFunction(declaration.initializer) ||
          isFunctionExpression(declaration.initializer))
      ) {
        matches.push(declaration.initializer);
      }
    }
  }

  return matches;
};

interface NamedExportResolution {
  hasReExport: boolean;
  matches: SupportedFunction[];
}

const getNamedExportedFunctionDefinitions = (
  file: ParsedSourceFile,
  exportedName: string
): NamedExportResolution => {
  const matches: SupportedFunction[] = [];

  for (const statement of file.sourceFile.statements) {
    if (
      !(
        isExportDeclaration(statement) &&
        statement.exportClause &&
        isNamedExports(statement.exportClause)
      )
    ) {
      continue;
    }

    const exportedElements = statement.exportClause.elements.filter(
      (element) => element.name.text === exportedName
    );

    if (exportedElements.length === 0) {
      continue;
    }

    if (statement.moduleSpecifier) {
      return { hasReExport: true, matches: [] };
    }

    for (const element of exportedElements) {
      const localName = element.propertyName?.text ?? element.name.text;
      const declaration = getFunctionDefinition(file, localName);

      if (declaration) {
        matches.push(declaration);
      }
    }
  }

  return { hasReExport: false, matches };
};

const getExportedFunctionDefinition = (
  file: ParsedSourceFile,
  exportedName: string
): SupportedFunction | null => {
  if (exportedName === "default") {
    const declaration = getFunctionDefinition(file, "default");
    return declaration && hasExportModifier(declaration) ? declaration : null;
  }

  const directMatches = getDirectExportedFunctionDefinitions(
    file,
    exportedName
  );
  const namedResolution = getNamedExportedFunctionDefinitions(
    file,
    exportedName
  );

  if (namedResolution.hasReExport) {
    return null;
  }

  const matches = [...directMatches, ...namedResolution.matches];
  return matches.length === 1 ? (matches[0] ?? null) : null;
};

const getImportedLocalName = (
  file: ParsedSourceFile,
  moduleName: string,
  importedName: string
): string | null => {
  const matches: string[] = [];

  for (const statement of file.sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === moduleName &&
        statement.importClause?.namedBindings &&
        isNamedImports(statement.importClause.namedBindings)
      )
    ) {
      continue;
    }

    for (const element of statement.importClause.namedBindings.elements) {
      const sourceName = element.propertyName?.text ?? element.name.text;

      if (sourceName === importedName) {
        matches.push(element.name.text);
      }
    }
  }

  return matches.length === 1 ? (matches[0] ?? null) : null;
};

const getImportedNamespaceLocalName = (
  file: ParsedSourceFile,
  moduleName: string
): string | null => {
  const matches: string[] = [];

  for (const statement of file.sourceFile.statements) {
    if (
      isImportDeclaration(statement) &&
      isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === moduleName &&
      statement.importClause?.namedBindings &&
      isNamespaceImport(statement.importClause.namedBindings)
    ) {
      matches.push(statement.importClause.namedBindings.name.text);
    }
  }

  return matches.length === 1 ? (matches[0] ?? null) : null;
};

const isKnownResolverFactoryCall = (expression: Expression): boolean => {
  if (!isCallExpression(expression)) {
    return false;
  }

  const callee = expression.expression;
  let factoryName: string | null = null;

  if (isIdentifier(callee)) {
    factoryName = callee.text;
  } else if (isPropertyAccessExpression(callee)) {
    factoryName = callee.name.text;
  }

  return factoryName ? KNOWN_RESOLVER_FACTORY_PATTERN.test(factoryName) : false;
};

const getCallValidationState = (call: CallExpression): FormValidationState => {
  const options = call.arguments[0];

  if (!options) {
    return "absent";
  }

  if (!isObjectLiteralExpression(options)) {
    return "unknown";
  }

  if (
    options.properties.some(
      (property) =>
        isSpreadAssignment(property) || isComputedPropertyName(property.name)
    )
  ) {
    return "unknown";
  }

  const resolverProperties = options.properties.filter((property) => {
    if (
      !(
        isPropertyAssignment(property) ||
        isShorthandPropertyAssignment(property)
      )
    ) {
      return false;
    }

    const name = property.name;
    return (
      (isIdentifier(name) || isStringLiteral(name)) && name.text === "resolver"
    );
  });

  if (resolverProperties.length === 0) {
    return "absent";
  }

  const resolverProperty = resolverProperties[0];

  if (
    resolverProperties.length !== 1 ||
    !resolverProperty ||
    !isPropertyAssignment(resolverProperty)
  ) {
    return "unknown";
  }

  const resolverValue = resolverProperty.initializer;

  return isKnownResolverFactoryCall(resolverValue) ||
    isArrowFunction(resolverValue) ||
    isFunctionExpression(resolverValue)
    ? "present"
    : "unknown";
};

const walkOwnerNodes = (
  owner: ScopeOwner,
  visitor: (node: Node, ancestors: Node[]) => void
): void => {
  const visit = (node: Node, ancestors: Node[]): void => {
    if (node !== owner && isScopeOwner(node)) {
      visitor(node, ancestors);
      return;
    }

    visitor(node, ancestors);
    forEachChild(node, (child) => visit(child, [...ancestors, node]));
  };

  visit(owner, []);
};

const getContainingFunction = (node: Node): ScopeOwner | null => {
  let current = node.parent;

  while (current) {
    if (isScopeOwner(current)) {
      return current;
    }

    current = current.parent;
  }

  return null;
};

const collectBindingNames = (
  bindingName: BindingName,
  names: Set<string>
): void => {
  if (isIdentifier(bindingName)) {
    names.add(bindingName.text);
    return;
  }

  for (const element of bindingName.elements) {
    if (!isOmittedExpression(element)) {
      collectBindingNames(element.name, names);
    }
  }
};

const hasNodeFlag = (flags: NodeFlags, flag: NodeFlags): boolean =>
  Math.floor(flags / flag) % 2 === 1;

const variableListIsBlockScoped = (
  declarationList: VariableDeclarationList
): boolean =>
  hasNodeFlag(declarationList.flags, NodeFlags.Let) ||
  hasNodeFlag(declarationList.flags, NodeFlags.Const) ||
  hasNodeFlag(declarationList.flags, NodeFlags.Using);

const isLexicalBindingContainer = (node: Node): boolean => {
  switch (node.kind) {
    case SyntaxKind.Block:
    case SyntaxKind.CaseBlock:
    case SyntaxKind.CatchClause:
    case SyntaxKind.ForInStatement:
    case SyntaxKind.ForOfStatement:
    case SyntaxKind.ForStatement:
      return true;
    default:
      return false;
  }
};

const getNearestLexicalBindingContainer = (ancestors: Node[]): Node | null => {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];

    if (ancestor && isLexicalBindingContainer(ancestor)) {
      return ancestor;
    }
  }

  return null;
};

const addLexicalBinding = (
  lexicalByContainer: Map<Node, Set<string>>,
  container: Node | null,
  bindingName: BindingName
): void => {
  if (!container) {
    return;
  }

  const names = lexicalByContainer.get(container) ?? new Set<string>();
  collectBindingNames(bindingName, names);
  lexicalByContainer.set(container, names);
};

const getOwnerBindingIndex = (owner: ScopeOwner): OwnerBindingIndex => {
  const cached = ownerBindingCache.get(owner);

  if (cached) {
    return cached;
  }

  const functionScoped = new Set<string>();
  const lexicalByContainer = new Map<Node, Set<string>>();

  if (
    (isFunctionDeclaration(owner) || isFunctionExpression(owner)) &&
    owner.name
  ) {
    functionScoped.add(owner.name.text);
  }

  for (const parameter of owner.parameters) {
    collectBindingNames(parameter.name, functionScoped);
  }

  walkOwnerNodes(owner, (node, ancestors) => {
    if (node === owner) {
      return;
    }

    if (isVariableDeclaration(node) && isVariableDeclarationList(node.parent)) {
      if (!variableListIsBlockScoped(node.parent)) {
        collectBindingNames(node.name, functionScoped);
        return;
      }

      addLexicalBinding(
        lexicalByContainer,
        getNearestLexicalBindingContainer(ancestors),
        node.name
      );
    } else if (isFunctionDeclaration(node) && node.name) {
      addLexicalBinding(
        lexicalByContainer,
        getNearestLexicalBindingContainer(ancestors),
        node.name
      );
    } else if (isClassDeclaration(node) && node.name) {
      addLexicalBinding(
        lexicalByContainer,
        getNearestLexicalBindingContainer(ancestors),
        node.name
      );
    } else if (isCatchClause(node) && node.variableDeclaration) {
      addLexicalBinding(
        lexicalByContainer,
        node,
        node.variableDeclaration.name
      );
    }
  });

  const index = { functionScoped, lexicalByContainer };
  ownerBindingCache.set(owner, index);
  return index;
};

const ownerShadowsReference = (
  owner: ScopeOwner,
  name: string,
  referenceAncestors: Node[]
): boolean => {
  const bindings = getOwnerBindingIndex(owner);

  return (
    bindings.functionScoped.has(name) ||
    referenceAncestors.some((ancestor) =>
      bindings.lexicalByContainer.get(ancestor)?.has(name)
    )
  );
};

const getAncestorsThroughOwner = (node: Node, owner: ScopeOwner): Node[] => {
  const ancestors: Node[] = [];
  let current = node.parent;

  while (current) {
    ancestors.push(current);

    if (current === owner) {
      break;
    }

    current = current.parent;
  }

  return ancestors;
};

const hasLocalShadow = (call: CallExpression, name: string): boolean => {
  const owner = getContainingFunction(call);

  return owner
    ? ownerShadowsReference(owner, name, getAncestorsThroughOwner(call, owner))
    : false;
};

const getDirectUseFormCall = (
  expression: Expression,
  useFormLocalName: string
): CallExpression | null =>
  isCallExpression(expression) &&
  isIdentifier(expression.expression) &&
  expression.expression.text === useFormLocalName
    ? expression
    : null;

const getObjectPropertyExpression = (
  expression: Expression,
  propertyName: string
): Expression | null => {
  if (!isObjectLiteralExpression(expression)) {
    return null;
  }

  const matches = expression.properties.flatMap((property) => {
    if (isShorthandPropertyAssignment(property)) {
      return property.name.text === propertyName ? [property.name] : [];
    }

    if (isPropertyAssignment(property)) {
      const name = property.name;
      const isMatch =
        (isIdentifier(name) || isStringLiteral(name)) &&
        name.text === propertyName;

      return isMatch ? [property.initializer] : [];
    }

    return [];
  });

  return matches.length === 1 ? (matches[0] ?? null) : null;
};

const getReturnedValueExpressions = (
  expression: Expression,
  returnSelector: string | null | undefined
): Expression[] => {
  if (returnSelector === null) {
    if (
      isObjectLiteralExpression(expression) &&
      expression.properties.length === 1
    ) {
      const property = expression.properties[0];

      if (property && isSpreadAssignment(property)) {
        return [property.expression];
      }
    }

    return [expression];
  }

  if (returnSelector) {
    const selected = getObjectPropertyExpression(expression, returnSelector);
    return selected ? [selected] : [];
  }

  if (!isObjectLiteralExpression(expression)) {
    return [expression];
  }

  return expression.properties.flatMap((property) => {
    if (isShorthandPropertyAssignment(property)) {
      return [property.name];
    }

    if (isPropertyAssignment(property)) {
      return [property.initializer];
    }

    return isSpreadAssignment(property) ? [property.expression] : [];
  });
};

const createProviderScope = (
  file: ParsedSourceFile,
  declaration: SupportedFunction
): SourceScope => {
  const start = declaration.getStart(file.sourceFile);
  const end = declaration.getEnd();

  return {
    content: file.content.slice(start, end),
    end,
    file,
    line: file.sourceFile.getLineAndCharacterOfPosition(start).line + 1,
    start,
  };
};

const getFunctionKey = (
  file: ParsedSourceFile,
  declaration: SupportedFunction
): string =>
  JSON.stringify([
    path.resolve(file.filePath),
    declaration.getStart(file.sourceFile),
  ]);

const resolveFunctionForCall = (
  file: ParsedSourceFile,
  call: CallExpression,
  environment: ProviderEnvironment
): ResolvedFunction | null => {
  if (!isIdentifier(call.expression)) {
    return null;
  }

  const callName = call.expression.text;
  if (hasLocalShadow(call, callName)) {
    return null;
  }

  const localDeclaration = getFunctionDefinition(file, callName);

  if (localDeclaration) {
    return { declaration: localDeclaration, file };
  }

  const imported = getImportedBinding(file, callName);

  if (!imported) {
    return null;
  }

  const resolvedPath = resolveProjectModulePath({
    containingFile: file.filePath,
    hasCandidate: (candidate) =>
      environment.filesByPath.has(path.resolve(candidate)),
    moduleName: imported.moduleName,
    project: environment.project,
    resolver: environment.resolver,
  });
  const targetFile = resolvedPath
    ? environment.filesByPath.get(path.resolve(resolvedPath))
    : null;
  const declaration = targetFile
    ? getExportedFunctionDefinition(targetFile, imported.importedName)
    : null;

  return targetFile && declaration ? { declaration, file: targetFile } : null;
};

interface ReturnedExpressionContext {
  activeFunctions: Set<string>;
  declarationScope: SourceScope;
  depth: number;
  environment: ProviderEnvironment;
  file: ParsedSourceFile;
  useFormLocalName: string | null;
  variableInitializers: Map<string, Expression>;
}

const resolveReturnedExpression = (
  expression: Expression,
  context: ReturnedExpressionContext,
  activeAliases: Set<string> = new Set()
): FormHookProvider | null => {
  if (isIdentifier(expression)) {
    if (
      activeAliases.size >= MAX_FORM_ALIAS_HOPS ||
      activeAliases.has(expression.text)
    ) {
      return null;
    }

    const initializer = context.variableInitializers.get(expression.text);

    if (!initializer) {
      return null;
    }

    return resolveReturnedExpression(
      initializer,
      context,
      new Set([...activeAliases, expression.text])
    );
  }

  if (!isCallExpression(expression)) {
    return null;
  }

  if (
    context.useFormLocalName &&
    getDirectUseFormCall(expression, context.useFormLocalName) &&
    !hasLocalShadow(expression, context.useFormLocalName)
  ) {
    return {
      scope: context.declarationScope,
      validation: getCallValidationState(expression),
    };
  }

  if (context.depth >= MAX_FORM_HOOK_HOPS) {
    return null;
  }

  const nested = resolveFunctionForCall(
    context.file,
    expression,
    context.environment
  );

  if (!nested) {
    return null;
  }

  const provider = getReturnedUseFormProvider(
    nested.file,
    nested.declaration,
    null,
    context.environment,
    context.depth + 1,
    context.activeFunctions
  );

  return provider
    ? { scope: context.declarationScope, validation: provider.validation }
    : null;
};

function getReturnedUseFormProvider(
  file: ParsedSourceFile,
  declaration: SupportedFunction,
  returnSelector: string | null | undefined,
  environment: ProviderEnvironment,
  depth = 0,
  activeFunctions: Set<string> = new Set()
): FormHookProvider | null {
  const functionKey = getFunctionKey(file, declaration);

  if (activeFunctions.has(functionKey)) {
    return null;
  }

  const nextActiveFunctions = new Set(activeFunctions);
  nextActiveFunctions.add(functionKey);
  const useFormLocalName = getImportedLocalName(
    file,
    "react-hook-form",
    "useForm"
  );
  const ambiguousInitializers = new Set<string>();
  const variableInitializers = new Map<string, Expression>();
  const returnedExpressions: Expression[] = [];
  const markInitializerAmbiguous = (variableName: string): void => {
    variableInitializers.delete(variableName);
    ambiguousInitializers.add(variableName);
  };

  walkOwnerNodes(declaration, (node) => {
    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.initializer
    ) {
      const variableName = node.name.text;

      if (variableInitializers.has(variableName)) {
        markInitializerAmbiguous(variableName);
      } else if (!ambiguousInitializers.has(variableName)) {
        variableInitializers.set(variableName, node.initializer);
      }
    }

    if (
      isBinaryExpression(node) &&
      node.operatorToken.kind >= SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= SyntaxKind.LastAssignment &&
      isIdentifier(node.left)
    ) {
      markInitializerAmbiguous(node.left.text);
    }

    if (isReturnStatement(node) && node.expression) {
      returnedExpressions.push(node.expression);
    }
  });

  if (isArrowFunction(declaration) && !isBlock(declaration.body)) {
    returnedExpressions.push(declaration.body);
  }

  const declarationScope = createProviderScope(file, declaration);
  const selectedExpressionGroups = returnedExpressions.map((expression) =>
    getReturnedValueExpressions(expression, returnSelector)
  );

  if (
    returnSelector &&
    selectedExpressionGroups.some((expressions) => expressions.length !== 1)
  ) {
    return null;
  }

  const selectedExpressions = selectedExpressionGroups.flat();
  const providers = selectedExpressions
    .map((expression) =>
      resolveReturnedExpression(expression, {
        activeFunctions: nextActiveFunctions,
        declarationScope,
        depth,
        environment,
        file,
        useFormLocalName,
        variableInitializers,
      })
    )
    .filter((provider): provider is FormHookProvider => Boolean(provider));

  if (
    providers.length !== selectedExpressions.length ||
    providers.length === 0 ||
    providers.some(
      (provider) => provider.validation !== providers[0]?.validation
    )
  ) {
    return null;
  }

  return {
    scope: declarationScope,
    validation: providers[0]?.validation ?? "unknown",
  };
}

type BindingSelectors = Map<string, Set<null | string>>;
type FormBindingSelectors = Map<Node, BindingSelectors>;
type MutatedBindings = Map<Node, ReadonlySet<string>>;

const addFormBindingSelector = (
  selectorsByContainer: FormBindingSelectors,
  container: Node,
  bindingName: string,
  returnSelector: null | string
): void => {
  const selectors = selectorsByContainer.get(container) ?? new Map();
  const bindingSelectors = selectors.get(bindingName) ?? new Set();
  bindingSelectors.add(returnSelector);
  selectors.set(bindingName, bindingSelectors);
  selectorsByContainer.set(container, selectors);
};

const getReferenceBindingContainer = (
  owner: ScopeOwner,
  bindingName: string,
  ancestors: Node[]
): Node | null => {
  const isShadowedByNestedOwner = ancestors.some(
    (ancestor) =>
      ancestor !== owner &&
      isScopeOwner(ancestor) &&
      ownerShadowsReference(ancestor, bindingName, ancestors)
  );

  if (isShadowedByNestedOwner) {
    return null;
  }

  const bindings = getOwnerBindingIndex(owner);

  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];

    if (
      ancestor &&
      bindings.lexicalByContainer.get(ancestor)?.has(bindingName)
    ) {
      return ancestor;
    }
  }

  return bindings.functionScoped.has(bindingName) ? owner : null;
};

const getDeclarationBindingContainer = (
  owner: ScopeOwner,
  declaration: VariableDeclaration
): Node | null => {
  const declarationList = declaration.parent;

  if (!isVariableDeclarationList(declarationList)) {
    return null;
  }

  if (!variableListIsBlockScoped(declarationList)) {
    return owner;
  }

  let current: Node | undefined = declarationList.parent;

  while (current && current !== owner) {
    if (isLexicalBindingContainer(current)) {
      return current;
    }

    current = current.parent;
  }

  return null;
};

interface FormBindingReference {
  bindingName: string;
  returnSelector: null | string;
}

const getFormBindingReference = (node: Node): FormBindingReference | null => {
  if (isJsxSpreadAttribute(node) && isIdentifier(node.expression)) {
    const opening = node.parent.parent;
    const isFormComponent =
      (isJsxOpeningElement(opening) || isJsxSelfClosingElement(opening)) &&
      FORM_COMPONENT_NAME_PATTERN.test(getJsxTagName(opening) ?? "");

    return isFormComponent
      ? { bindingName: node.expression.text, returnSelector: null }
      : null;
  }

  if (
    !(isPropertyAccessExpression(node) && FORM_API_NAMES.has(node.name.text))
  ) {
    return null;
  }

  if (isIdentifier(node.expression)) {
    return { bindingName: node.expression.text, returnSelector: null };
  }

  if (
    isPropertyAccessExpression(node.expression) &&
    isIdentifier(node.expression.expression)
  ) {
    return {
      bindingName: node.expression.expression.text,
      returnSelector: node.expression.name.text,
    };
  }

  return null;
};

const getFormBindingSelectors = (owner: ScopeOwner): FormBindingSelectors => {
  const selectors = new Map<Node, BindingSelectors>();

  walkNodes(owner, (node, ancestors) => {
    const reference = getFormBindingReference(node);

    if (!reference) {
      return;
    }

    const container = getReferenceBindingContainer(
      owner,
      reference.bindingName,
      ancestors
    );

    if (container) {
      addFormBindingSelector(
        selectors,
        container,
        reference.bindingName,
        reference.returnSelector
      );
    }
  });

  return selectors;
};

const addMutatedBinding = (
  mutations: Map<Node, Set<string>>,
  container: Node,
  bindingName: string
): void => {
  const names = mutations.get(container) ?? new Set<string>();
  names.add(bindingName);
  mutations.set(container, names);
};

const getConsumerBindingMutations = (owner: ScopeOwner): MutatedBindings => {
  const initializerCounts = new Map<Node, Map<string, number>>();
  const mutations = new Map<Node, Set<string>>();

  walkOwnerNodes(owner, (node) => {
    if (!(isVariableDeclaration(node) && node.initializer)) {
      return;
    }

    const container = getDeclarationBindingContainer(owner, node);

    if (!container) {
      return;
    }

    const names = new Set<string>();
    collectBindingNames(node.name, names);
    const counts =
      initializerCounts.get(container) ?? new Map<string, number>();

    for (const name of names) {
      const count = (counts.get(name) ?? 0) + 1;
      counts.set(name, count);

      if (count > 1) {
        addMutatedBinding(mutations, container, name);
      }
    }

    initializerCounts.set(container, counts);
  });

  walkNodes(owner, (node, ancestors) => {
    if (
      !(
        isBinaryExpression(node) &&
        node.operatorToken.kind >= SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= SyntaxKind.LastAssignment &&
        isIdentifier(node.left)
      )
    ) {
      return;
    }

    const container = getReferenceBindingContainer(
      owner,
      node.left.text,
      ancestors
    );

    if (container) {
      addMutatedBinding(mutations, container, node.left.text);
    }
  });

  return mutations;
};

const bindingPatternHasFormSignal = (
  bindingName: BindingName,
  formBindingSelectors: Map<string, Set<null | string>>
): boolean => {
  const isFormSignal = (name: string): boolean =>
    name === "form" ||
    FORM_API_NAMES.has(name) ||
    formBindingSelectors.has(name);

  if (isIdentifier(bindingName)) {
    return isFormSignal(bindingName.text);
  }

  return bindingName.elements.some((element) => {
    if (isOmittedExpression(element)) {
      return false;
    }

    const propertyName = element.propertyName;
    const propertyIsFormSignal = Boolean(
      propertyName &&
        (isIdentifier(propertyName) || isStringLiteral(propertyName)) &&
        isFormSignal(propertyName.text)
    );

    return (
      propertyIsFormSignal ||
      bindingPatternHasFormSignal(element.name, formBindingSelectors)
    );
  });
};

const getBindingPatternReturnSelector = (
  pattern: ObjectBindingPattern,
  formBindingSelectors: Map<string, Set<null | string>>
): ReturnSelector | undefined => {
  const selectors: (null | string)[] = [];
  let hasUnsupportedFormBinding = false;

  for (const element of pattern.elements) {
    const sourceName = element.propertyName ?? element.name;
    const sourceIsForm =
      (isIdentifier(sourceName) || isStringLiteral(sourceName)) &&
      sourceName.text === "form";

    if (
      (isObjectBindingPattern(element.name) ||
        isArrayBindingPattern(element.name)) &&
      (sourceIsForm ||
        bindingPatternHasFormSignal(element.name, formBindingSelectors))
    ) {
      hasUnsupportedFormBinding = true;
    }

    if (!(isIdentifier(sourceName) || isStringLiteral(sourceName))) {
      continue;
    }

    if (FORM_API_NAMES.has(sourceName.text)) {
      selectors.push(null);
      continue;
    }

    if (
      isIdentifier(element.name) &&
      formBindingSelectors.has(element.name.text)
    ) {
      selectors.push(sourceName.text);
    }
  }

  const uniqueSelectors = new Set(selectors);

  if (hasUnsupportedFormBinding) {
    return UNCERTAIN_RETURN_SELECTOR;
  }

  if (uniqueSelectors.size === 1) {
    return selectors[0];
  }

  return selectors.length > 0 ? UNCERTAIN_RETURN_SELECTOR : undefined;
};

const getHookCallName = (call: CallExpression): string | null => {
  if (isIdentifier(call.expression)) {
    return call.expression.text;
  }

  if (isPropertyAccessExpression(call.expression)) {
    return call.expression.name.text;
  }

  if (
    isElementAccessExpression(call.expression) &&
    call.expression.argumentExpression &&
    isStringLiteral(call.expression.argumentExpression)
  ) {
    return call.expression.argumentExpression.text;
  }

  return null;
};

const objectBindingHasRelevantMutation = (
  pattern: ObjectBindingPattern,
  selectors: BindingSelectors,
  mutations: ReadonlySet<string>
): boolean =>
  pattern.elements.some((element) => {
    if (!isIdentifier(element.name)) {
      return false;
    }

    const sourceName = element.propertyName ?? element.name;
    const sourceIsFormApi =
      (isIdentifier(sourceName) || isStringLiteral(sourceName)) &&
      FORM_API_NAMES.has(sourceName.text);

    return (
      mutations.has(element.name.text) &&
      (sourceIsFormApi || selectors.has(element.name.text))
    );
  });

const getConsumerReturnSelector = (
  bindingName: BindingName,
  selectors: BindingSelectors,
  mutations: ReadonlySet<string>
): ReturnSelector | undefined => {
  if (isIdentifier(bindingName)) {
    const bindingSelectors = selectors.get(bindingName.text);

    if (!bindingSelectors) {
      return;
    }

    const onlySelector = bindingSelectors.values().next().value;
    return !mutations.has(bindingName.text) &&
      bindingSelectors.size === 1 &&
      onlySelector !== undefined
      ? onlySelector
      : UNCERTAIN_RETURN_SELECTOR;
  }

  if (isArrayBindingPattern(bindingName)) {
    const hasUsedBinding = bindingName.elements.some(
      (element) =>
        !isOmittedExpression(element) &&
        isIdentifier(element.name) &&
        selectors.has(element.name.text)
    );
    return hasUsedBinding ? UNCERTAIN_RETURN_SELECTOR : undefined;
  }

  if (!isObjectBindingPattern(bindingName)) {
    return;
  }

  const returnSelector = getBindingPatternReturnSelector(
    bindingName,
    selectors
  );

  return returnSelector !== undefined &&
    objectBindingHasRelevantMutation(bindingName, selectors, mutations)
    ? UNCERTAIN_RETURN_SELECTOR
    : returnSelector;
};

const getHookCandidate = (
  node: Node,
  formBindingSelectors: FormBindingSelectors,
  mutatedBindings: MutatedBindings,
  file: ParsedSourceFile,
  owner: ScopeOwner
): HookCallCandidate | null => {
  if (!isVariableDeclaration(node)) {
    return null;
  }

  const initializer = node.initializer;

  if (!(initializer && isCallExpression(initializer))) {
    return null;
  }

  const hookName = getHookCallName(initializer);

  if (!hookName?.startsWith("use")) {
    return null;
  }

  const importedCallee = isIdentifier(initializer.expression)
    ? getImportedBinding(file, hookName)
    : null;

  if (
    importedCallee?.moduleName === "react-hook-form" &&
    importedCallee.importedName === "useForm"
  ) {
    return null;
  }

  const bindingContainer = getDeclarationBindingContainer(owner, node);

  if (!bindingContainer) {
    return null;
  }

  const selectorsForContainer =
    formBindingSelectors.get(bindingContainer) ?? new Map();
  const mutationsForContainer =
    mutatedBindings.get(bindingContainer) ?? new Set<string>();
  const returnSelector = getConsumerReturnSelector(
    node.name,
    selectorsForContainer,
    mutationsForContainer
  );

  return returnSelector === undefined
    ? null
    : { call: initializer, returnSelector };
};

const getHookCalls = (
  file: ParsedSourceFile,
  owner: ScopeOwner | null
): HookCallCollection => {
  const candidates: HookCallCandidate[] = [];
  let truncated = false;

  if (!owner) {
    return { candidates, truncated };
  }

  const formBindingSelectors = getFormBindingSelectors(owner);
  const mutatedBindings = getConsumerBindingMutations(owner);

  const addCandidate = (candidate: HookCallCandidate): void => {
    if (candidates.length >= MAX_HOOK_CALLS_PER_SCOPE) {
      truncated = true;
      return;
    }

    candidates.push(candidate);
  };

  walkOwnerNodes(owner, (node) => {
    const candidate = getHookCandidate(
      node,
      formBindingSelectors,
      mutatedBindings,
      file,
      owner
    );

    if (candidate) {
      addCandidate(candidate);
    }
  });

  return { candidates, truncated };
};

const resolveProviderForCall = (
  candidate: HookCallCandidate,
  context: ProviderResolutionContext
): FormHookProvider | null => {
  const { call, returnSelector } = candidate;

  if (returnSelector === UNCERTAIN_RETURN_SELECTOR) {
    return null;
  }
  const environment: ProviderEnvironment = {
    filesByPath: context.filesByPath,
    project: context.project,
    resolver: context.resolver,
  };
  const resolved = resolveFunctionForCall(
    context.consumer.file,
    call,
    environment
  );

  return resolved
    ? getReturnedUseFormProvider(
        resolved.file,
        resolved.declaration,
        returnSelector,
        environment
      )
    : null;
};

const addFlow = (
  flowsByConsumerKey: Map<string, FormHookFlow[]>,
  flow: FormHookFlow
): void => {
  const consumerKey = getSourceScopeKey(flow.consumer);
  const flows = flowsByConsumerKey.get(consumerKey) ?? [];
  flows.push(flow);
  flowsByConsumerKey.set(consumerKey, flows);
};

const functionOwnsUseFormCall = (
  file: ParsedSourceFile,
  declaration: ScopeOwner
): boolean => {
  const useFormLocalName = getImportedLocalName(
    file,
    "react-hook-form",
    "useForm"
  );
  const useFormNamespaceName = getImportedNamespaceLocalName(
    file,
    "react-hook-form"
  );

  if (!(useFormLocalName || useFormNamespaceName)) {
    return false;
  }

  let ownsUseFormCall = false;
  walkOwnerNodes(declaration, (node) => {
    if (!isCallExpression(node)) {
      return;
    }

    const usesNamedImport = Boolean(
      useFormLocalName && getDirectUseFormCall(node, useFormLocalName)
    );
    const usesNamespaceImport = Boolean(
      useFormNamespaceName &&
        isPropertyAccessExpression(node.expression) &&
        isIdentifier(node.expression.expression) &&
        node.expression.expression.text === useFormNamespaceName &&
        node.expression.name.text === "useForm"
    );
    const importedBindingName = usesNamedImport
      ? useFormLocalName
      : useFormNamespaceName;

    if (
      (usesNamedImport || usesNamespaceImport) &&
      importedBindingName &&
      !hasLocalShadow(node, importedBindingName)
    ) {
      ownsUseFormCall = true;
    }
  });
  return ownsUseFormCall;
};

const functionContainsUseFormCall = (declaration: ScopeOwner): boolean => {
  let containsUseFormCall = false;

  walkOwnerNodes(declaration, (node) => {
    if (isCallExpression(node) && getHookCallName(node) === "useForm") {
      containsUseFormCall = true;
    }
  });

  return containsUseFormCall;
};

const getProviderScopeKeys = (
  files: ParsedSourceFile[],
  environment: ProviderEnvironment
): Set<string> => {
  const keys = new Set<string>();

  for (const file of files) {
    for (const definition of getTopLevelFunctionDefinitions(file)) {
      if (!definition.name.startsWith("use")) {
        continue;
      }

      if (functionOwnsUseFormCall(file, definition.declaration)) {
        keys.add(
          getSourceScopeKey(createProviderScope(file, definition.declaration))
        );
        continue;
      }

      const provider = getReturnedUseFormProvider(
        file,
        definition.declaration,
        undefined,
        environment
      );

      if (provider) {
        keys.add(getSourceScopeKey(provider.scope));
      }
    }
  }

  return keys;
};

const getScopeOwners = (files: ParsedSourceFile[]): Map<string, ScopeOwner> => {
  const owners = new Map<string, ScopeOwner>();

  for (const file of files) {
    walkNodes(file.sourceFile, (node, ancestors) => {
      if (
        !isScopeOwner(node) ||
        ancestors.some((ancestor) => isScopeOwner(ancestor))
      ) {
        return;
      }

      const key = JSON.stringify([
        path.resolve(file.filePath),
        node.getStart(file.sourceFile),
        node.getEnd(),
      ]);
      owners.set(key, node);
    });
  }

  return owners;
};

const buildFormHookAnalysis = async (
  project: ProjectDiscovery,
  filesystemRoot: string
): Promise<FormHookAnalysis> => {
  const files = await parseProjectSourceFiles(project);
  const filesByPath = new Map(
    files.map((file) => [path.resolve(file.filePath), file])
  );
  const resolver = getProjectModuleResolver(project, filesystemRoot);
  const environment = { filesByPath, project, resolver };
  const formScopes = await findOwnedSourceScopes(project, FORM_PATTERN);
  const flowsByConsumerKey = new Map<string, FormHookFlow[]>();
  const providerScopeKeys = getProviderScopeKeys(files, environment);
  const scopeOwners = getScopeOwners(files);
  const directUseFormScopes = formScopes.filter((scope) => {
    const owner = scopeOwners.get(getSourceScopeKey(scope));
    return owner ? functionContainsUseFormCall(owner) : false;
  });

  for (const consumer of formScopes) {
    const hookCalls = getHookCalls(
      consumer.file,
      scopeOwners.get(getSourceScopeKey(consumer)) ?? null
    );

    for (const candidate of hookCalls.candidates) {
      const provider = resolveProviderForCall(candidate, {
        consumer,
        filesByPath,
        project,
        resolver,
      });

      if (!provider) {
        addFlow(flowsByConsumerKey, {
          boundary: "the custom form hook could not be resolved unambiguously",
          consumer,
          kind: "uncertain",
        });
        continue;
      }

      providerScopeKeys.add(getSourceScopeKey(provider.scope));
      addFlow(flowsByConsumerKey, {
        consumer,
        kind: "resolved",
        provider,
      });
    }

    if (hookCalls.truncated) {
      addFlow(flowsByConsumerKey, {
        boundary: `the ${MAX_HOOK_CALLS_PER_SCOPE}-hook analysis limit was reached`,
        consumer,
        kind: "uncertain",
      });
    }
  }

  return { directUseFormScopes, flowsByConsumerKey, providerScopeKeys };
};

const analyzeFormHookFlow = (
  project: ProjectDiscovery,
  filesystemRoot: string
): Promise<FormHookAnalysis> => {
  const cacheKey = path.resolve(filesystemRoot);
  const projectCache = formHookAnalysisCache.get(project) ?? new Map();
  const cached = projectCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const analysis = buildFormHookAnalysis(project, filesystemRoot);
  projectCache.set(cacheKey, analysis);
  formHookAnalysisCache.set(project, projectCache);
  return analysis;
};

export type { FormHookAnalysis, FormHookFlow };
export {
  analyzeFormHookFlow,
  getSourceScopeKey,
  MAX_FORM_HOOK_HOPS,
  MAX_HOOK_CALLS_PER_SCOPE,
};
