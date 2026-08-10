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
  isVariableStatement,
  type MethodDeclaration,
  type Node,
  SyntaxKind,
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

interface ResolvedFunction {
  declaration: SupportedFunction;
  file: ParsedSourceFile;
}

const formHookAnalysisCache = new WeakMap<
  ProjectDiscovery,
  Map<string, Promise<FormHookAnalysis>>
>();
const localShadowCache = new WeakMap<ScopeOwner, Map<string, boolean>>();

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
): FunctionDefinition[] => {
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
  visitor: (node: Node) => void
): void => {
  const visit = (node: Node): void => {
    if (node !== owner && isScopeOwner(node)) {
      visitor(node);
      return;
    }

    visitor(node);
    forEachChild(node, visit);
  };

  visit(owner);
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

const bindingNameContainsIdentifier = (
  bindingName: BindingName,
  identifier: string
): boolean => {
  if (isIdentifier(bindingName)) {
    return bindingName.text === identifier;
  }

  return bindingName.elements.some(
    (element) =>
      !isOmittedExpression(element) &&
      bindingNameContainsIdentifier(element.name, identifier)
  );
};

const hasLocalShadow = (call: CallExpression, name: string): boolean => {
  const owner = getContainingFunction(call);

  if (!owner) {
    return false;
  }

  const ownerCache = localShadowCache.get(owner) ?? new Map<string, boolean>();

  if (ownerCache.has(name)) {
    return ownerCache.get(name) ?? false;
  }

  let shadowed = owner.parameters.some((parameter) =>
    bindingNameContainsIdentifier(parameter.name, name)
  );
  walkOwnerNodes(owner, (node) => {
    if (shadowed) {
      return;
    }

    if (
      (isVariableDeclaration(node) &&
        bindingNameContainsIdentifier(node.name, name)) ||
      (isFunctionDeclaration(node) && node.name?.text === name)
    ) {
      shadowed = true;
    }
  });

  ownerCache.set(name, shadowed);
  localShadowCache.set(owner, ownerCache);
  return shadowed;
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

    if (
      isPropertyAssignment(property) &&
      property.name.getText(expression.getSourceFile()) === propertyName
    ) {
      return [property.initializer];
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

const addFormBindingSelector = (
  selectors: Map<string, Set<null | string>>,
  bindingName: string,
  returnSelector: null | string
): void => {
  const bindingSelectors = selectors.get(bindingName) ?? new Set();
  bindingSelectors.add(returnSelector);
  selectors.set(bindingName, bindingSelectors);
};

const getFormBindingSelectors = (
  owner: ScopeOwner
): Map<string, Set<null | string>> => {
  const selectors = new Map<string, Set<null | string>>();

  walkOwnerNodes(owner, (node) => {
    if (isJsxSpreadAttribute(node) && isIdentifier(node.expression)) {
      const opening = node.parent.parent;

      if (
        (isJsxOpeningElement(opening) || isJsxSelfClosingElement(opening)) &&
        FORM_COMPONENT_NAME_PATTERN.test(getJsxTagName(opening) ?? "")
      ) {
        addFormBindingSelector(selectors, node.expression.text, null);
        return;
      }
    }

    if (
      !(isPropertyAccessExpression(node) && FORM_API_NAMES.has(node.name.text))
    ) {
      return;
    }

    if (isIdentifier(node.expression)) {
      addFormBindingSelector(selectors, node.expression.text, null);
      return;
    }

    if (
      isPropertyAccessExpression(node.expression) &&
      isIdentifier(node.expression.expression)
    ) {
      addFormBindingSelector(
        selectors,
        node.expression.expression.text,
        node.expression.name.text
      );
    }
  });

  return selectors;
};

const getBindingPatternReturnSelector = (
  pattern: import("typescript").ObjectBindingPattern,
  formBindingSelectors: Map<string, Set<null | string>>
): string | null | undefined => {
  const selectors = pattern.elements.flatMap((element) => {
    const sourceName = element.propertyName ?? element.name;

    if (!isIdentifier(sourceName)) {
      return [];
    }

    if (FORM_API_NAMES.has(sourceName.text)) {
      return [null];
    }

    if (
      isIdentifier(element.name) &&
      formBindingSelectors.has(element.name.text)
    ) {
      return [sourceName.text];
    }

    return [];
  });

  const uniqueSelectors = new Set(selectors);

  return uniqueSelectors.size === 1 ? selectors[0] : undefined;
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

const getHookCandidate = (
  node: Node,
  formBindingSelectors: Map<string, Set<null | string>>,
  file: ParsedSourceFile
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

  if (isIdentifier(node.name)) {
    const selectors = formBindingSelectors.get(node.name.text);

    if (!selectors) {
      return null;
    }

    const onlySelector = selectors.values().next().value;

    return {
      call: initializer,
      returnSelector:
        selectors.size === 1 && onlySelector !== undefined
          ? onlySelector
          : UNCERTAIN_RETURN_SELECTOR,
    };
  }

  if (isArrayBindingPattern(node.name)) {
    const hasUsedBinding = node.name.elements.some(
      (element) =>
        !isOmittedExpression(element) &&
        isIdentifier(element.name) &&
        formBindingSelectors.has(element.name.text)
    );
    return hasUsedBinding
      ? { call: initializer, returnSelector: UNCERTAIN_RETURN_SELECTOR }
      : null;
  }

  if (!isObjectBindingPattern(node.name)) {
    return null;
  }

  const returnSelector = getBindingPatternReturnSelector(
    node.name,
    formBindingSelectors
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

  const addCandidate = (candidate: HookCallCandidate): void => {
    if (candidates.length >= MAX_HOOK_CALLS_PER_SCOPE) {
      truncated = true;
      return;
    }

    candidates.push(candidate);
  };

  walkOwnerNodes(owner, (node) => {
    const candidate = getHookCandidate(node, formBindingSelectors, file);

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
  declaration: SupportedFunction
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

  return { flowsByConsumerKey, providerScopeKeys };
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
