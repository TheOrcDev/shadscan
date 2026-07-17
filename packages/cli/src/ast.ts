import {
  createSourceFile,
  forEachChild,
  isIdentifier,
  isJsxAttribute,
  isJsxElement,
  isJsxExpression,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isJsxText,
  isStringLiteral,
  type JsxChild,
  type JsxElement,
  type JsxOpeningLikeElement,
  type Node,
  ScriptKind,
  ScriptTarget,
  type SourceFile,
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

const UPPERCASE_COMPONENT_PATTERN = /^[A-Z]/;
const JSX_FILE_PATTERN = /\.[jt]sx$/;
const parsedSourceFileCache = new WeakMap<
  ProjectDiscovery,
  Promise<ParsedSourceFile[]>
>();

const loadParsedSourceFiles = async (
  project: ProjectDiscovery
): Promise<ParsedSourceFile[]> => {
  const sourceFiles = (await getProjectSourceFiles(project)).filter((file) =>
    JSX_FILE_PATTERN.test(file.path)
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
        ScriptKind.TSX
      ),
    });
  }

  return files;
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

const getJsxAttribute = (
  node: JsxOpeningLikeElement,
  name: string
): string | true | null => {
  for (const property of node.attributes.properties) {
    if (!isJsxAttribute(property) || property.name.getText() !== name) {
      continue;
    }

    if (!property.initializer) {
      return true;
    }

    if (isStringLiteral(property.initializer)) {
      return property.initializer.text;
    }

    if (
      isJsxExpression(property.initializer) &&
      property.initializer.expression &&
      isStringLiteral(property.initializer.expression)
    ) {
      return property.initializer.expression.text;
    }

    return true;
  }

  return null;
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

const childHasAccessibleText = (child: JsxChild): boolean => {
  if (isJsxText(child)) {
    return child.getText().trim().length > 0;
  }

  if (
    isJsxExpression(child) &&
    child.expression &&
    isStringLiteral(child.expression)
  ) {
    return child.expression.text.trim().length > 0;
  }

  if (isJsxElement(child)) {
    return hasAccessibleText(child.children);
  }

  return false;
};

const hasAccessibleText = (children: readonly JsxChild[]): boolean =>
  children.some((child) => childHasAccessibleText(child));

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

export type { JsxNodeVisit, ParsedSourceFile };
export {
  ancestorHasTagName,
  getJsxAttribute,
  getJsxTagName,
  getLineNumber,
  hasAccessibleText,
  hasJsxAttribute,
  hasVisualChild,
  parseProjectSourceFiles,
  visitJsxNodes,
};
