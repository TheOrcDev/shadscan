import { Buffer } from "node:buffer";
import path from "node:path";
import {
  isIdentifier,
  isImportDeclaration,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isNamedImports,
  isNamespaceImport,
  isStringLiteral,
  isStringLiteralLike,
  isVariableStatement,
  type Node,
  type SourceFile as TypeScriptSourceFile,
} from "typescript";
import {
  getJsxTagName,
  getLineNumber,
  getNearestFunctionOwner,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  walkNodes,
} from "../ast";
import type { AuditRule } from "../audit";
import type { ProjectDiscovery } from "../discovery";
import { advisory, fail, notApplicable, pass } from "./rule-result";
import { readProjectSourceFile, type SourceFile } from "./source-files";

type CmdkBooleanState = "disabled" | "selected";

interface CmdkBindings {
  commandObjects: Set<string>;
  itemComponents: Set<string>;
  namespaces: Set<string>;
}

interface CmdkItemScopes {
  fallbackRanges: Array<{ end: number; start: number }>;
  functionOwners: Set<string>;
  referencedModuleRanges: Array<{ end: number; start: number }>;
}

interface CssAtRule {
  name: "custom-variant" | "import";
  text: string;
}

interface StateVariantUse {
  filePath: string;
  kind: "bare" | "presence";
  line: number;
  state: CmdkBooleanState;
  token: string;
}

interface StateVariantContracts {
  complete: boolean;
  disabled: boolean;
  selected: boolean;
}

interface StylesheetTraversal {
  activePaths: Set<string>;
  loadedBytes: number;
  loadedFiles: Map<string, SourceFile>;
}

const CMDK_MODULE = "cmdk";
const SHADCN_TAILWIND_STYLESHEET = "shadcn/tailwind.css";
const MAX_STYLESHEET_IMPORTS = 64;
const MAX_STYLESHEET_BYTES = 8 * 1024 * 1024;
const CSS_AT_RULE_NAMES = ["custom-variant", "import"] as const;
const CSS_IMPORT_SPECIFIER_PATTERN =
  /^@import\s+(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^\s);]+))/i;
const CSS_IDENTIFIER_CHARACTER_PATTERN = /[a-z0-9_-]/i;
const CSS_NOT_FUNCTION_PATTERN = /:not\s*$/i;
const CUSTOM_DATA_DISABLED_PATTERN = /^@custom-variant\s+data-disabled\b/i;
const CUSTOM_DATA_SELECTED_PATTERN = /^@custom-variant\s+data-selected\b/i;
const QUERY_OR_HASH_PATTERN = /[?#]/;
const STATE_VARIANT_PATTERN =
  /(?:^|:)(?:(?:group|peer)-)?data-(?:(selected|disabled)|\[(selected|disabled)\])(?:\/[^:\s]+)?(?=:)/;
const COMMAND_ITEM_NAMED_STATE_VARIANT_PATTERN =
  /(?:^|:)(?:group|peer)-data-(?:selected|disabled|\[(?:selected|disabled)\])\/command-item(?=:)/;
const WHITESPACE_PATTERN = /\s+/;

const createEmptyContracts = (): StateVariantContracts => ({
  complete: true,
  disabled: false,
  selected: false,
});

const getCmdkBindings = (sourceFile: TypeScriptSourceFile): CmdkBindings => {
  const bindings: CmdkBindings = {
    commandObjects: new Set<string>(),
    itemComponents: new Set<string>(),
    namespaces: new Set<string>(),
  };

  for (const statement of sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === CMDK_MODULE &&
        statement.importClause?.namedBindings
      )
    ) {
      continue;
    }

    const namedBindings = statement.importClause.namedBindings;
    if (isNamespaceImport(namedBindings)) {
      bindings.namespaces.add(namedBindings.name.text);
      continue;
    }

    if (!isNamedImports(namedBindings)) {
      continue;
    }

    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === "Command") {
        bindings.commandObjects.add(element.name.text);
      }
      if (importedName === "CommandItem") {
        bindings.itemComponents.add(element.name.text);
      }
    }
  }

  return bindings;
};

const isCmdkItemTagName = (
  tagName: string,
  bindings: CmdkBindings
): boolean => {
  if (bindings.itemComponents.has(tagName)) {
    return true;
  }

  for (const commandObject of bindings.commandObjects) {
    if (tagName === `${commandObject}.Item`) {
      return true;
    }
  }

  for (const namespace of bindings.namespaces) {
    if (
      tagName === `${namespace}.Command.Item` ||
      tagName === `${namespace}.CommandItem`
    ) {
      return true;
    }
  }

  return false;
};

const getFunctionOwnerKey = (file: ParsedSourceFile, owner: Node): string =>
  `${owner.getStart(file.sourceFile)}:${owner.getEnd()}`;

const getCmdkItemScopes = (file: ParsedSourceFile): CmdkItemScopes => {
  const bindings = getCmdkBindings(file.sourceFile);
  const scopes: CmdkItemScopes = {
    fallbackRanges: [],
    functionOwners: new Set<string>(),
    referencedModuleRanges: [],
  };

  walkNodes(file.sourceFile, (node, ancestors) => {
    if (!(isJsxOpeningElement(node) || isJsxSelfClosingElement(node))) {
      return;
    }

    const tagName = getJsxTagName(node);
    if (!(tagName && isCmdkItemTagName(tagName, bindings))) {
      return;
    }

    const owner = getNearestFunctionOwner(ancestors);
    if (owner) {
      scopes.functionOwners.add(getFunctionOwnerKey(file, owner));
      return;
    }

    scopes.fallbackRanges.push({
      end: node.getEnd(),
      start: node.getStart(file.sourceFile),
    });
  });

  const referencedNames = new Set<string>();
  walkNodes(file.sourceFile, (node, ancestors) => {
    if (!isIdentifier(node)) {
      return;
    }

    const owner = getNearestFunctionOwner(ancestors);
    if (owner && scopes.functionOwners.has(getFunctionOwnerKey(file, owner))) {
      referencedNames.add(node.text);
    }
  });

  for (const statement of file.sourceFile.statements) {
    if (!isVariableStatement(statement)) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (
        isIdentifier(declaration.name) &&
        declaration.initializer &&
        referencedNames.has(declaration.name.text)
      ) {
        scopes.referencedModuleRanges.push({
          end: declaration.initializer.getEnd(),
          start: declaration.initializer.getStart(file.sourceFile),
        });
      }
    }
  }

  return scopes;
};

const getStateVariantUse = (
  token: string,
  file: ParsedSourceFile,
  line: number
): StateVariantUse | null => {
  const match = STATE_VARIANT_PATTERN.exec(token);
  if (!match) {
    return null;
  }

  const bareState = match[1] as CmdkBooleanState | undefined;
  const presenceState = match[2] as CmdkBooleanState | undefined;
  const state = bareState ?? presenceState;
  if (!state) {
    return null;
  }

  return {
    filePath: file.filePath,
    kind: bareState ? "bare" : "presence",
    line,
    state,
    token,
  };
};

const nodeIsInCmdkItemScope = (
  file: ParsedSourceFile,
  node: Node,
  ancestors: Node[],
  scopes: CmdkItemScopes
): boolean => {
  const owner = getNearestFunctionOwner(ancestors);
  if (owner && scopes.functionOwners.has(getFunctionOwnerKey(file, owner))) {
    return true;
  }

  const position = node.getStart(file.sourceFile);
  return [...scopes.fallbackRanges, ...scopes.referencedModuleRanges].some(
    (range) => position >= range.start && position <= range.end
  );
};

const getStateVariantUses = (
  file: ParsedSourceFile,
  scopes: CmdkItemScopes
): StateVariantUse[] => {
  const uses: StateVariantUse[] = [];

  walkNodes(file.sourceFile, (node, ancestors) => {
    if (!isStringLiteralLike(node)) {
      return;
    }

    const line = getLineNumber(file, node);
    const isInItemScope = nodeIsInCmdkItemScope(file, node, ancestors, scopes);
    for (const token of node.text.split(WHITESPACE_PATTERN)) {
      const use = getStateVariantUse(token, file, line);
      if (
        use &&
        (isInItemScope || COMMAND_ITEM_NAMED_STATE_VARIANT_PATTERN.test(token))
      ) {
        uses.push(use);
      }
    }
  });

  return uses;
};

const skipCssComment = (content: string, start: number): number => {
  const end = content.indexOf("*/", start + 2);
  return end === -1 ? content.length : end + 2;
};

const skipCssString = (content: string, start: number): number => {
  const quote = content[start];

  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === quote) {
      return index + 1;
    }
  }

  return content.length;
};

const getCssAtRuleName = (
  content: string,
  start: number
): CssAtRule["name"] | null => {
  for (const name of CSS_AT_RULE_NAMES) {
    const prefix = `@${name}`;
    const candidate = content.slice(start, start + prefix.length);
    if (candidate.toLowerCase() !== prefix) {
      continue;
    }

    const boundary = content[start + prefix.length];
    if (!(boundary && CSS_IDENTIFIER_CHARACTER_PATTERN.test(boundary))) {
      return name;
    }
  }

  return null;
};

const findCssAtRuleEnd = (content: string, start: number): number => {
  let blockDepth = 0;

  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === "/" && nextCharacter === "*") {
      index = skipCssComment(content, index) - 1;
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipCssString(content, index) - 1;
      continue;
    }
    if (character === "{") {
      blockDepth += 1;
      continue;
    }
    if (character === "}" && blockDepth > 0) {
      blockDepth -= 1;
      if (blockDepth === 0) {
        return index + 1;
      }
      continue;
    }
    if (character === ";" && blockDepth === 0) {
      return index + 1;
    }
  }

  return content.length;
};

const getCssAtRules = (content: string): CssAtRule[] => {
  const rules: CssAtRule[] = [];

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === "/" && nextCharacter === "*") {
      index = skipCssComment(content, index) - 1;
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipCssString(content, index) - 1;
      continue;
    }
    if (character !== "@") {
      continue;
    }

    const name = getCssAtRuleName(content, index);
    if (!name) {
      continue;
    }

    const end = findCssAtRuleEnd(content, index);
    rules.push({ name, text: content.slice(index, end) });
    index = end - 1;
  }

  return rules;
};

const getStylesheetImportSpecifier = (rule: CssAtRule): string | null => {
  if (rule.name !== "import") {
    return null;
  }

  const match = CSS_IMPORT_SPECIFIER_PATTERN.exec(rule.text);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
};

const getCustomVariantState = (rule: CssAtRule): CmdkBooleanState | null => {
  if (rule.name !== "custom-variant") {
    return null;
  }
  if (CUSTOM_DATA_DISABLED_PATTERN.test(rule.text)) {
    return "disabled";
  }
  if (CUSTOM_DATA_SELECTED_PATTERN.test(rule.text)) {
    return "selected";
  }
  return null;
};

const positionIsInsideNotFunction = (
  content: string,
  targetPosition: number
): boolean => {
  const functionStack: boolean[] = [];

  for (let index = 0; index < targetPosition; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (character === "/" && nextCharacter === "*") {
      index = skipCssComment(content, index) - 1;
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipCssString(content, index) - 1;
      continue;
    }
    if (character === "(") {
      functionStack.push(
        CSS_NOT_FUNCTION_PATTERN.test(content.slice(0, index))
      );
      continue;
    }
    if (character === ")") {
      functionStack.pop();
    }
  }

  return functionStack.includes(true);
};

const definitionIsValueAware = (
  definition: string,
  state: CmdkBooleanState
): boolean => {
  const trueValuePattern = new RegExp(
    `\\[data-${state}\\s*=\\s*(?:["']true["']|true)\\]`,
    "g"
  );
  const presentAndNotFalsePattern = new RegExp(
    `\\[data-${state}\\]\\s*:not\\(\\s*\\[data-${state}\\s*=\\s*(?:["']false["']|false)\\]\\s*\\)`,
    "g"
  );
  const anyStateAttributePattern = new RegExp(
    `\\[data-${state}(?:\\s*=\\s*[^\\]]+)?\\]`
  );
  let foundValueAwareSelector = false;
  const removeSafeSelector = (selector: string): string => {
    foundValueAwareSelector = true;
    return " ".repeat(selector.length);
  };
  const definitionWithoutSafeFalseGuards = definition.replace(
    presentAndNotFalsePattern,
    removeSafeSelector
  );
  for (const match of definitionWithoutSafeFalseGuards.matchAll(
    trueValuePattern
  )) {
    if (
      match.index !== undefined &&
      positionIsInsideNotFunction(definitionWithoutSafeFalseGuards, match.index)
    ) {
      return false;
    }
  }
  const remainingDefinition = definitionWithoutSafeFalseGuards.replace(
    trueValuePattern,
    removeSafeSelector
  );

  return (
    foundValueAwareSelector &&
    !anyStateAttributePattern.test(remainingDefinition)
  );
};

const getLocalImportCandidates = (
  project: ProjectDiscovery,
  importerPath: string,
  specifier: string
): string[] => {
  if (!specifier.startsWith(".")) {
    return [];
  }

  const cleanSpecifier = specifier.split(QUERY_OR_HASH_PATTERN, 1)[0];
  if (!cleanSpecifier) {
    return [];
  }

  const resolvedPath = path.resolve(path.dirname(importerPath), cleanSpecifier);
  const candidates = path.extname(resolvedPath)
    ? [resolvedPath]
    : [`${resolvedPath}.css`, path.join(resolvedPath, "index.css")];

  return candidates.filter((candidate) => {
    const relativePath = path.relative(project.rootDir, candidate);
    return (
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath) &&
      path.extname(candidate) === ".css"
    );
  });
};

const readBoundedLocalStylesheetImport = async (
  project: ProjectDiscovery,
  importerPath: string,
  specifier: string,
  contracts: StateVariantContracts,
  traversal: StylesheetTraversal
): Promise<SourceFile | null> => {
  for (const candidate of getLocalImportCandidates(
    project,
    importerPath,
    specifier
  )) {
    const candidatePath = path.resolve(candidate);
    const cachedFile = traversal.loadedFiles.get(candidatePath);
    if (cachedFile) {
      return cachedFile;
    }
    if (traversal.loadedFiles.size >= MAX_STYLESHEET_IMPORTS) {
      contracts.complete = false;
      return null;
    }

    const file = await readProjectSourceFile(project, candidate);
    if (!file) {
      continue;
    }

    const importedBytes = Buffer.byteLength(file.content, "utf8");
    if (traversal.loadedBytes + importedBytes > MAX_STYLESHEET_BYTES) {
      contracts.complete = false;
      return null;
    }

    traversal.loadedBytes += importedBytes;
    traversal.loadedFiles.set(candidatePath, file);
    return file;
  }

  return null;
};

const applyStylesheetInOrder = async (
  project: ProjectDiscovery,
  file: SourceFile,
  contracts: StateVariantContracts,
  traversal: StylesheetTraversal
): Promise<void> => {
  const filePath = path.resolve(file.path);
  if (traversal.activePaths.has(filePath)) {
    return;
  }

  traversal.activePaths.add(filePath);
  try {
    for (const rule of getCssAtRules(file.content)) {
      const state = getCustomVariantState(rule);
      if (state) {
        contracts[state] = definitionIsValueAware(rule.text, state);
        continue;
      }

      const specifier = getStylesheetImportSpecifier(rule);
      if (!specifier) {
        continue;
      }
      if (specifier === SHADCN_TAILWIND_STYLESHEET) {
        contracts.disabled = true;
        contracts.selected = true;
        continue;
      }

      const importedFile = await readBoundedLocalStylesheetImport(
        project,
        file.path,
        specifier,
        contracts,
        traversal
      );
      if (importedFile) {
        await applyStylesheetInOrder(
          project,
          importedFile,
          contracts,
          traversal
        );
      }
    }
  } finally {
    traversal.activePaths.delete(filePath);
  }
};

const getStateVariantContracts = async (
  project: ProjectDiscovery
): Promise<StateVariantContracts> => {
  const contracts = createEmptyContracts();
  const entryPath = project.paths.tailwindCss;
  if (!entryPath) {
    return contracts;
  }

  const entryFile = await readProjectSourceFile(project, entryPath);
  if (!entryFile) {
    return contracts;
  }

  const entryBytes = Buffer.byteLength(entryFile.content, "utf8");
  const traversal: StylesheetTraversal = {
    activePaths: new Set<string>(),
    loadedBytes: entryBytes,
    loadedFiles: new Map<string, SourceFile>([
      [path.resolve(entryFile.path), entryFile],
    ]),
  };
  if (entryBytes > MAX_STYLESHEET_BYTES) {
    contracts.complete = false;
    return contracts;
  }

  await applyStylesheetInOrder(project, entryFile, contracts, traversal);

  return contracts;
};

const getPresenceViolation = (
  uses: StateVariantUse[]
): StateVariantUse | null =>
  uses.find((use) => use.kind === "presence") ?? null;

const getBareViolation = (
  uses: StateVariantUse[],
  contracts: StateVariantContracts
): StateVariantUse | null =>
  uses.find((use) => use.kind === "bare" && !contracts[use.state]) ?? null;

const cmdkItemStateVariantsUseValuesRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "high",
  description:
    "Checks that cmdk selected and disabled styles distinguish true from false boolean data attributes.",
  id: "cmdk-item-state-variants-use-values",
  maxScore: 2,
  run: async ({ project }) => {
    const files = await parseProjectSourceFiles(project);
    const cmdkItemFiles = files
      .map((file) => ({ file, scopes: getCmdkItemScopes(file) }))
      .filter(
        ({ scopes }) =>
          scopes.functionOwners.size > 0 || scopes.fallbackRanges.length > 0
      );
    if (cmdkItemFiles.length === 0) {
      return notApplicable(
        "No project-owned cmdk item implementation was found."
      );
    }

    const uses = cmdkItemFiles.flatMap(({ file, scopes }) =>
      getStateVariantUses(file, scopes)
    );
    if (uses.length === 0) {
      return pass(
        "Project-owned cmdk item implementations use value-aware state variants."
      );
    }

    const contracts = await getStateVariantContracts(project);
    const presenceViolation = getPresenceViolation(uses);
    if (presenceViolation) {
      return fail(
        `Cmdk renders data-${presenceViolation.state} as "true" or "false", but "${presenceViolation.token}" can match both values.`,
        `Use data-[${presenceViolation.state}=true]:… or the equivalent named group selector.`,
        {
          filePath: presenceViolation.filePath,
          line: presenceViolation.line,
          roast:
            "Every command is dressed like the chosen one. The selector forgot to check the value.",
        }
      );
    }

    if (!contracts.complete) {
      const unresolvedUse = uses[0];
      return advisory(
        "The configured stylesheet import graph exceeded safe analysis limits, so cmdk's bare boolean state variants could not be verified.",
        "Use explicit data-[selected=true] and data-[disabled=true] variants, or reduce the loaded CSS graph so Shadscan can verify its custom variants.",
        unresolvedUse?.filePath,
        unresolvedUse?.line
      );
    }

    const violation = getBareViolation(uses, contracts);
    if (!violation) {
      return pass(
        "Loaded Tailwind variants distinguish true cmdk item states from false ones."
      );
    }

    return fail(
      `Cmdk renders data-${violation.state} as "true" or "false", but "${violation.token}" can match both values.`,
      `Use data-[${violation.state}=true]:… (or the equivalent named group selector), or ensure the final loaded custom variant is value-aware, such as @import "shadcn/tailwind.css" without a later presence-only override.`,
      {
        filePath: violation.filePath,
        line: violation.line,
        roast:
          "Every command is dressed like the chosen one. The selector forgot to check the value.",
      }
    );
  },
  severity: "warning",
  title: "cmdk item state variants are value-aware",
};

export { cmdkItemStateVariantsUseValuesRule };
