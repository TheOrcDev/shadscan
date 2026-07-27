import path from "node:path";
import {
  isArrowFunction,
  isBinaryExpression,
  isBindingElement,
  isExportAssignment,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isJsxAttribute,
  isJsxExpression,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isJsxSpreadAttribute,
  isNamedImports,
  isObjectBindingPattern,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableDeclaration,
  type JsxOpeningLikeElement,
  type Node,
  SyntaxKind,
} from "typescript";
import { type ParsedSourceFile, walkNodes } from "../ast";
import type { ProjectDiscovery } from "../discovery";
import {
  type ProjectModuleResolver,
  resolveProjectModulePath,
} from "./module-resolution";

/**
 * How many component boundaries a pending value may cross before the chain
 * is treated as unverifiable. Two covers the common shape — call site,
 * shared form, submit button — without turning a rule into a whole-program
 * dataflow analysis.
 */
const MAX_PROP_HOPS = 2;
const GENERIC_FEEDBACK_PATTERN = /<(?:Spinner|Loader\w*)\b|aria-busy\s*=/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
const PENDING_NAME_PATTERN =
  /^(?:isPending|pending|isSubmitting|isLoading|loading)$/;

interface PendingFlowOptions {
  file: ParsedSourceFile;
  filesByPath: Map<string, ParsedSourceFile>;
  names: string[];
  project: ProjectDiscovery;
  resolver: ProjectModuleResolver;
  scopeEnd: number;
  scopeStart: number;
}

interface PendingFlowResult {
  /** Where the chain stopped, for a failure message that stays actionable. */
  boundary: string | null;
  satisfied: boolean;
}

interface PropTarget {
  component: Node;
  file: ParsedSourceFile;
  localName: string;
}

const hasDisabledFor = (text: string, name: string): boolean =>
  new RegExp(`disabled\\s*=\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(text);

const hasFeedbackFor = (text: string, name: string): boolean =>
  GENERIC_FEEDBACK_PATTERN.test(text) ||
  new RegExp(
    `\\b${name}\\s*\\?\\s*(?:\\(\\s*)*(?:["'\`][^"'\`]+["'\`]|<)`
  ).test(text);

/**
 * A trigger that both blocks duplicate submission and shows progress. Both
 * halves must appear together — a spinner beside an always-enabled button
 * is not duplicate-submit prevention.
 */
const isTriggerSatisfied = (text: string, names: string[]): boolean =>
  names.some((name) => hasDisabledFor(text, name)) &&
  names.some((name) => hasFeedbackFor(text, name));

/** Identifiers an attribute value passes straight through, or null if computed. */
const getReferencedNames = (node: Node, names: string[]): string[] | null => {
  if (isParenthesizedExpression(node)) {
    return getReferencedNames(node.expression, names);
  }

  if (isIdentifier(node)) {
    return names.includes(node.text) ? [node.text] : [];
  }

  // `isPending={mutation.isPending}` — the shape every query client
  // produces, and the one the issue reported.
  if (isPropertyAccessExpression(node)) {
    return names.includes(node.name.text) ? [node.name.text] : [];
  }

  // `busy={isPending || isDeleting}` still passes a pending value through.
  if (
    isBinaryExpression(node) &&
    (node.operatorToken.kind === SyntaxKind.BarBarToken ||
      node.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken)
  ) {
    const left = getReferencedNames(node.left, names);
    const right = getReferencedNames(node.right, names);

    return left && right ? [...left, ...right] : null;
  }

  return null;
};

const getImportedName = (
  file: ParsedSourceFile,
  localName: string
): { importedName: string; moduleName: string } | null => {
  const matches: { importedName: string; moduleName: string }[] = [];

  for (const statement of file.sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier)
      )
    ) {
      continue;
    }

    const moduleName = statement.moduleSpecifier.text;
    const importClause = statement.importClause;

    if (importClause?.name?.text === localName) {
      matches.push({ importedName: "default", moduleName });
    }

    const namedBindings = importClause?.namedBindings;

    if (namedBindings && isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        if (element.name.text === localName) {
          matches.push({
            importedName: element.propertyName?.text ?? element.name.text,
            moduleName,
          });
        }
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
};

const isComponentNode = (node: Node): boolean =>
  isArrowFunction(node) ||
  isFunctionDeclaration(node) ||
  isFunctionExpression(node);

const findDefaultExportName = (file: ParsedSourceFile): string | null => {
  for (const statement of file.sourceFile.statements) {
    if (
      isFunctionDeclaration(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === SyntaxKind.DefaultKeyword
      )
    ) {
      return statement.name?.text ?? null;
    }

    if (isExportAssignment(statement) && isIdentifier(statement.expression)) {
      return statement.expression.text;
    }
  }

  return null;
};

/** Resolves an export name to its single component declaration, or null. */
const findComponentByExportName = (
  file: ParsedSourceFile,
  exportName: string
): Node | null => {
  const name =
    exportName === "default" ? findDefaultExportName(file) : exportName;

  if (!name) {
    return null;
  }

  const declarations: Node[] = [];

  walkNodes(file.sourceFile, (node) => {
    if (isFunctionDeclaration(node) && node.name?.text === name) {
      declarations.push(node);
      return;
    }

    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      isComponentNode(node.initializer)
    ) {
      declarations.push(node.initializer);
    }
  });

  return declarations.length === 1 ? (declarations[0] ?? null) : null;
};

/**
 * Finds the identifier a prop is bound to inside the component. A rename
 * (`{ busy: isBusy }`) is followed; an untracked shape is refused.
 */
const getPropLocalName = (
  component: Node,
  file: ParsedSourceFile,
  propName: string
): string | null => {
  const parameters = isComponentNode(component)
    ? (component as { parameters?: readonly { name: Node }[] }).parameters
    : undefined;
  const parameter = parameters?.[0];

  if (!parameter) {
    return null;
  }

  if (isIdentifier(parameter.name)) {
    return `${parameter.name.text}.${propName}`;
  }

  if (!isObjectBindingPattern(parameter.name)) {
    return null;
  }

  for (const element of parameter.name.elements) {
    if (!isBindingElement(element)) {
      continue;
    }

    const sourceName = element.propertyName ?? element.name;
    const key = isIdentifier(sourceName)
      ? sourceName.text
      : sourceName.getText(file.sourceFile);

    if (key === propName && isIdentifier(element.name)) {
      return element.name.text;
    }
  }

  return null;
};

const getJsxElementsInRange = (
  file: ParsedSourceFile,
  start: number,
  end: number
): JsxOpeningLikeElement[] => {
  const elements: JsxOpeningLikeElement[] = [];

  walkNodes(file.sourceFile, (node) => {
    if (
      (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) &&
      node.getStart(file.sourceFile) >= start &&
      node.getEnd() <= end
    ) {
      elements.push(node);
    }
  });

  return elements;
};

const resolvePropTarget = (
  element: JsxOpeningLikeElement,
  propName: string,
  options: Omit<PendingFlowOptions, "names" | "scopeEnd" | "scopeStart">
): PropTarget | null => {
  const { file, filesByPath, project, resolver } = options;
  const tagName = element.tagName.getText(file.sourceFile);

  if (!IDENTIFIER_PATTERN.test(tagName)) {
    return null;
  }

  const imported = getImportedName(file, tagName);

  if (!imported) {
    return null;
  }

  const resolvedPath = resolveProjectModulePath({
    containingFile: file.filePath,
    hasCandidate: (candidate) => filesByPath.has(candidate),
    moduleName: imported.moduleName,
    project,
    resolver,
  });
  const targetFile = resolvedPath
    ? filesByPath.get(path.resolve(resolvedPath))
    : null;

  if (!targetFile) {
    return null;
  }

  const component = findComponentByExportName(
    targetFile,
    imported.importedName
  );

  if (!component) {
    return null;
  }

  const localName = getPropLocalName(component, targetFile, propName);

  return localName ? { component, file: targetFile, localName } : null;
};

/** Attribute names on this element that forward one of the pending values. */
const getForwardingAttributeNames = (
  element: JsxOpeningLikeElement,
  file: ParsedSourceFile,
  names: string[]
): string[] => {
  const forwarded: string[] = [];

  for (const attribute of element.attributes.properties) {
    if (
      !(
        isJsxAttribute(attribute) &&
        attribute.initializer &&
        isJsxExpression(attribute.initializer) &&
        attribute.initializer.expression
      )
    ) {
      continue;
    }

    const referenced = getReferencedNames(
      attribute.initializer.expression,
      names
    );

    if (referenced && referenced.length > 0) {
      forwarded.push(attribute.name.getText(file.sourceFile));
    }
  }

  return forwarded;
};

const followElement = (
  element: JsxOpeningLikeElement,
  options: PendingFlowOptions,
  depth: number
): PendingFlowResult => {
  const { file, names } = options;
  const tagName = element.tagName.getText(file.sourceFile);

  // A spread hides which prop carries the pending value, so the rename
  // cannot be tracked and the chain must not be assumed sound.
  if (element.attributes.properties.some(isJsxSpreadAttribute)) {
    return {
      boundary: `props are spread into <${tagName}>`,
      satisfied: false,
    };
  }

  let boundary: string | null = null;

  for (const propName of getForwardingAttributeNames(element, file, names)) {
    const target = resolvePropTarget(element, propName, options);

    if (!target) {
      boundary ??= `<${tagName}> could not be resolved`;
      continue;
    }

    const nested = followPendingProps(
      {
        ...options,
        file: target.file,
        names: [target.localName],
        scopeEnd: target.component.getEnd(),
        scopeStart: target.component.getStart(target.file.sourceFile),
      },
      depth + 1
    );

    if (nested.satisfied) {
      return nested;
    }

    boundary ??= nested.boundary;
  }

  return { boundary, satisfied: false };
};

function followPendingProps(
  options: PendingFlowOptions,
  depth: number
): PendingFlowResult {
  const { file, names, scopeEnd, scopeStart } = options;

  if (isTriggerSatisfied(file.content.slice(scopeStart, scopeEnd), names)) {
    return { boundary: null, satisfied: true };
  }

  if (depth >= MAX_PROP_HOPS) {
    return {
      boundary: `the prop chain reached its ${MAX_PROP_HOPS}-component limit`,
      satisfied: false,
    };
  }

  let boundary: string | null = null;

  for (const element of getJsxElementsInRange(file, scopeStart, scopeEnd)) {
    const result = followElement(element, options, depth);

    if (result.satisfied) {
      return result;
    }

    boundary ??= result.boundary;
  }

  return { boundary, satisfied: false };
}

/**
 * Local identifiers a component binds from a pending-named prop, including
 * renames (`{ pending: awaitingResponse }`). Without these a component that
 * receives its pending state and renames it looks like it never disables
 * anything.
 */
const getPendingAliases = (
  file: ParsedSourceFile,
  start: number,
  end: number
): string[] => {
  const aliases: string[] = [];

  walkNodes(file.sourceFile, (node) => {
    if (
      !(
        isBindingElement(node) &&
        node.getStart(file.sourceFile) >= start &&
        node.getEnd() <= end &&
        isIdentifier(node.name)
      )
    ) {
      return;
    }

    const source = node.propertyName ?? node.name;

    if (isIdentifier(source) && PENDING_NAME_PATTERN.test(source.text)) {
      aliases.push(node.name.text);
    }
  });

  return aliases;
};

/**
 * Follows a pending value from the scope that owns the async action into
 * the components it is passed to, looking for a trigger that disables
 * itself and shows progress. Resolution failure never counts as success.
 */
const resolvePendingThroughProps = (
  options: PendingFlowOptions
): PendingFlowResult => followPendingProps(options, 0);

export type { PendingFlowResult };
export { getPendingAliases, MAX_PROP_HOPS, resolvePendingThroughProps };
