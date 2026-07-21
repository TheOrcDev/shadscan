import {
  createSourceFile,
  type Expression,
  forEachChild,
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxFragment,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isJsxText,
  isMethodDeclaration,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isStringLiteral,
  type JsxChild,
  type JsxElement,
  type JsxOpeningLikeElement,
  type Node,
  ScriptKind,
  ScriptTarget,
  type SourceFile,
  SyntaxKind,
} from "typescript";
import type { ProjectDiscovery } from "./discovery";
import { getProjectSourceFiles } from "./rules/source-files";

interface ParsedSourceFile {
  content: string;
  filePath: string;
  sourceFile: SourceFile;
}

interface JsxNodeVisit {
  ancestors: Node[];
  file: ParsedSourceFile;
  node: JsxElement | JsxOpeningLikeElement;
}

interface SourceScope {
  content: string;
  end: number;
  file: ParsedSourceFile;
  line: number;
  start: number;
}

type EvidenceState = "invalid" | "unknown" | "valid";
type TextExpressionResolver = (expression: Expression) => EvidenceState;
type StaticJsxValue = boolean | null | number | string | undefined;

type JsxAttributeValue =
  | { kind: "absent" }
  | { kind: "dynamic" }
  | { kind: "static"; value: StaticJsxValue };

const UPPERCASE_COMPONENT_PATTERN = /^[A-Z]/;
const SCRIPT_FILE_PATTERN = /\.[jt]sx?$/;
const parsedSourceFileCache = new WeakMap<
  ProjectDiscovery,
  Promise<ParsedSourceFile[]>
>();

const getScriptKind = (filePath: string): ScriptKind => {
  if (filePath.endsWith(".tsx")) {
    return ScriptKind.TSX;
  }

  if (filePath.endsWith(".jsx")) {
    return ScriptKind.JSX;
  }

  return filePath.endsWith(".ts") ? ScriptKind.TS : ScriptKind.JS;
};

const loadParsedSourceFiles = async (
  project: ProjectDiscovery
): Promise<ParsedSourceFile[]> => {
  const sourceFiles = (await getProjectSourceFiles(project)).filter((file) =>
    SCRIPT_FILE_PATTERN.test(file.path)
  );
  const files: ParsedSourceFile[] = [];

  for (const file of sourceFiles) {
    files.push({
      content: file.content,
      filePath: file.path,
      sourceFile: createSourceFile(
        file.path,
        file.content,
        ScriptTarget.Latest,
        true,
        getScriptKind(file.path)
      ),
    });
  }

  return files;
};

const isFunctionOwner = (node: Node): boolean =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node) ||
  isMethodDeclaration(node);

const getNearestFunctionOwner = (ancestors: Node[]): Node | null => {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index];

    if (ancestor && isFunctionOwner(ancestor)) {
      return ancestor;
    }
  }

  return null;
};

const getJsxOwnerKey = (file: ParsedSourceFile, ancestors: Node[]): string => {
  const owner = getNearestFunctionOwner(ancestors);

  return JSON.stringify([
    file.filePath,
    owner?.getStart(file.sourceFile) ?? null,
    owner?.getEnd() ?? null,
  ]);
};

const getPatternIndexes = (content: string, pattern: RegExp): number[] => {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  return [...content.matchAll(matcher)].map((match) => match.index);
};

const getOwnedSourceScopes = (
  file: ParsedSourceFile,
  pattern: RegExp
): SourceScope[] => {
  const ownerNodes: Node[] = [];

  walkNodes(file.sourceFile, (node, ancestors) => {
    if (
      isFunctionOwner(node) &&
      !ancestors.some((ancestor) => isFunctionOwner(ancestor))
    ) {
      ownerNodes.push(node);
    }
  });

  const scopes = new Map<string, SourceScope>();

  for (const matchIndex of getPatternIndexes(file.content, pattern)) {
    const ownerNode = ownerNodes.find(
      (node) =>
        node.getStart(file.sourceFile) <= matchIndex &&
        node.getEnd() >= matchIndex
    );
    const start = ownerNode?.getStart(file.sourceFile) ?? 0;
    const end = ownerNode?.getEnd() ?? file.content.length;
    const key = `${start}:${end}`;

    if (scopes.has(key)) {
      continue;
    }

    scopes.set(key, {
      content: file.content.slice(start, end),
      end,
      file,
      line: file.sourceFile.getLineAndCharacterOfPosition(matchIndex).line + 1,
      start,
    });
  }

  return [...scopes.values()];
};

const getSourceScopeMatchLine = (
  scope: SourceScope,
  pattern: RegExp
): number => {
  const matchIndex = getPatternIndexes(scope.content, pattern)[0];

  if (matchIndex === undefined) {
    return scope.line;
  }

  return (
    scope.file.sourceFile.getLineAndCharacterOfPosition(
      scope.start + matchIndex
    ).line + 1
  );
};

const findOwnedSourceScopes = async (
  project: ProjectDiscovery,
  pattern: RegExp
): Promise<SourceScope[]> => {
  const files = await parseProjectSourceFiles(project);
  return files.flatMap((file) => getOwnedSourceScopes(file, pattern));
};

const parseProjectSourceFiles = (
  project: ProjectDiscovery
): Promise<ParsedSourceFile[]> => {
  const cachedFiles = parsedSourceFileCache.get(project);

  if (cachedFiles) {
    return cachedFiles;
  }

  const files = loadParsedSourceFiles(project);
  parsedSourceFileCache.set(project, files);
  return files;
};

const getJsxTagName = (node: JsxOpeningLikeElement): string | null => {
  const tagName = node.tagName;

  if (isIdentifier(tagName)) {
    return tagName.text;
  }

  return tagName.getText();
};

const getExpressionAttributeValue = (
  expression: Expression
): JsxAttributeValue => {
  if (
    isStringLiteral(expression) ||
    isNoSubstitutionTemplateLiteral(expression)
  ) {
    return { kind: "static", value: expression.text };
  }

  if (isNumericLiteral(expression)) {
    return { kind: "static", value: Number(expression.text) };
  }

  if (expression.kind === SyntaxKind.TrueKeyword) {
    return { kind: "static", value: true };
  }

  if (expression.kind === SyntaxKind.FalseKeyword) {
    return { kind: "static", value: false };
  }

  if (expression.kind === SyntaxKind.NullKeyword) {
    return { kind: "static", value: null };
  }

  if (isIdentifier(expression) && expression.text === "undefined") {
    return { kind: "static", value: undefined };
  }

  return { kind: "dynamic" };
};

const getJsxAttributeValue = (
  node: JsxOpeningLikeElement,
  name: string
): JsxAttributeValue => {
  for (const property of node.attributes.properties) {
    if (!isJsxAttribute(property) || property.name.getText() !== name) {
      continue;
    }

    if (!property.initializer) {
      return { kind: "static", value: true };
    }

    if (isStringLiteral(property.initializer)) {
      return { kind: "static", value: property.initializer.text };
    }

    if (!isJsxExpression(property.initializer)) {
      return { kind: "dynamic" };
    }

    if (!property.initializer.expression) {
      return { kind: "static", value: undefined };
    }

    return getExpressionAttributeValue(property.initializer.expression);
  }

  return { kind: "absent" };
};

const getLiteralAttributeIdentity = (value: string): string | null =>
  value.trim().length > 0 ? `literal:${value}` : null;

const getJsxAttributeIdentity = (
  node: JsxOpeningLikeElement,
  name: string
): string | null => {
  for (const property of node.attributes.properties) {
    if (!isJsxAttribute(property) || property.name.getText() !== name) {
      continue;
    }

    const initializer = property.initializer;
    if (!initializer) {
      return null;
    }

    if (isStringLiteral(initializer)) {
      return getLiteralAttributeIdentity(initializer.text);
    }

    if (!(isJsxExpression(initializer) && initializer.expression)) {
      return null;
    }

    const expression = initializer.expression;
    if (
      isStringLiteral(expression) ||
      isNoSubstitutionTemplateLiteral(expression)
    ) {
      return getLiteralAttributeIdentity(expression.text);
    }

    const expressionText = expression.getText().trim();
    return expressionText.length > 0 ? `expression:${expressionText}` : null;
  }

  return null;
};

const getOwnerScopedJsxAttributeIdentity = (
  file: ParsedSourceFile,
  ancestors: Node[],
  node: JsxOpeningLikeElement,
  name: string
): string | null => {
  const identity = getJsxAttributeIdentity(node, name);

  return identity
    ? JSON.stringify([getJsxOwnerKey(file, ancestors), identity])
    : null;
};

const getJsxAttribute = (
  node: JsxOpeningLikeElement,
  name: string
): string | true | null => {
  const attribute = getJsxAttributeValue(node, name);

  if (attribute.kind === "absent") {
    return null;
  }

  if (attribute.kind === "static" && typeof attribute.value === "string") {
    return attribute.value;
  }

  return true;
};

const getTextAttributeState = (
  node: JsxOpeningLikeElement,
  name: string,
  resolveExpression?: TextExpressionResolver
): EvidenceState => {
  const attribute = getJsxAttributeValue(node, name);

  if (attribute.kind === "dynamic") {
    if (resolveExpression) {
      for (const property of node.attributes.properties) {
        if (
          isJsxAttribute(property) &&
          property.name.getText() === name &&
          property.initializer &&
          isJsxExpression(property.initializer) &&
          property.initializer.expression
        ) {
          return resolveExpression(property.initializer.expression);
        }
      }
    }

    return "unknown";
  }

  if (attribute.kind === "static" && typeof attribute.value === "string") {
    return attribute.value.trim().length > 0 ? "valid" : "invalid";
  }

  return "invalid";
};

const hasJsxAttribute = (node: JsxOpeningLikeElement, name: string): boolean =>
  getJsxAttribute(node, name) !== null;

const getLineNumber = (file: ParsedSourceFile, node: Node): number =>
  file.sourceFile.getLineAndCharacterOfPosition(node.getStart(file.sourceFile))
    .line + 1;

const walkNodes = (
  node: Node,
  visitor: (node: Node, ancestors: Node[]) => void,
  ancestors: Node[] = []
): void => {
  visitor(node, ancestors);
  forEachChild(node, (child) => {
    walkNodes(child, visitor, [...ancestors, node]);
  });
};

const visitJsxNodes = (
  files: ParsedSourceFile[],
  visitor: (visit: JsxNodeVisit) => void
): void => {
  for (const file of files) {
    walkNodes(file.sourceFile, (node, ancestors) => {
      if (isJsxElement(node)) {
        visitor({ ancestors, file, node });
      }

      if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
        visitor({ ancestors, file, node });
      }
    });
  }
};

const resolveAccessibleTextExpression = (
  expression: Expression,
  resolveExpression?: TextExpressionResolver
): EvidenceState =>
  resolveExpression ? resolveExpression(expression) : "unknown";

const getChildAccessibleTextState = (
  child: JsxChild,
  resolveExpression?: TextExpressionResolver
): EvidenceState => {
  if (isJsxText(child)) {
    return child.getText().trim().length > 0 ? "valid" : "invalid";
  }

  if (isJsxExpression(child)) {
    const expression = child.expression;

    if (!expression) {
      return "invalid";
    }

    if (
      isStringLiteral(expression) ||
      isNoSubstitutionTemplateLiteral(expression)
    ) {
      return expression.text.trim().length > 0 ? "valid" : "invalid";
    }

    if (isNumericLiteral(expression)) {
      return "valid";
    }

    if (
      expression.kind === SyntaxKind.FalseKeyword ||
      expression.kind === SyntaxKind.NullKeyword ||
      expression.kind === SyntaxKind.TrueKeyword ||
      (isIdentifier(expression) && expression.text === "undefined")
    ) {
      return "invalid";
    }

    return resolveAccessibleTextExpression(expression, resolveExpression);
  }

  if (isJsxElement(child)) {
    return getAccessibleTextState(child.children, resolveExpression);
  }

  if (isJsxFragment(child)) {
    return getAccessibleTextState(child.children, resolveExpression);
  }

  return "invalid";
};

const getAccessibleTextState = (
  children: readonly JsxChild[],
  resolveExpression?: TextExpressionResolver
): EvidenceState => {
  let hasUnknownText = false;

  for (const child of children) {
    const state = getChildAccessibleTextState(child, resolveExpression);

    if (state === "valid") {
      return "valid";
    }

    if (state === "unknown") {
      hasUnknownText = true;
    }
  }

  return hasUnknownText ? "unknown" : "invalid";
};

const hasAccessibleText = (children: readonly JsxChild[]): boolean =>
  getAccessibleTextState(children) !== "invalid";

const childLooksVisual = (child: JsxChild): boolean => {
  if (isJsxElement(child)) {
    const tagName = getJsxTagName(child.openingElement);
    return Boolean(
      tagName &&
        (tagName === "svg" || UPPERCASE_COMPONENT_PATTERN.test(tagName))
    );
  }

  if (isJsxSelfClosingElement(child)) {
    const tagName = getJsxTagName(child);
    return Boolean(
      tagName &&
        (tagName === "svg" || UPPERCASE_COMPONENT_PATTERN.test(tagName))
    );
  }

  return false;
};

const hasVisualChild = (children: readonly JsxChild[]): boolean =>
  children.some((child) => childLooksVisual(child));

const ancestorHasTagName = (ancestors: Node[], tagName: string): boolean =>
  ancestors.some(
    (ancestor) =>
      isJsxElement(ancestor) &&
      getJsxTagName(ancestor.openingElement) === tagName
  );

export type {
  EvidenceState,
  JsxAttributeValue,
  JsxNodeVisit,
  ParsedSourceFile,
  SourceScope,
  TextExpressionResolver,
};
export {
  ancestorHasTagName,
  findOwnedSourceScopes,
  getAccessibleTextState,
  getJsxAttribute,
  getJsxAttributeIdentity,
  getJsxAttributeValue,
  getJsxOwnerKey,
  getJsxTagName,
  getLineNumber,
  getNearestFunctionOwner,
  getOwnerScopedJsxAttributeIdentity,
  getSourceScopeMatchLine,
  getTextAttributeState,
  hasAccessibleText,
  hasJsxAttribute,
  hasVisualChild,
  isFunctionOwner,
  parseProjectSourceFiles,
  visitJsxNodes,
  walkNodes,
};
