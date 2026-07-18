import path from "node:path";
import {
  canHaveModifiers,
  createSourceFile,
  type Expression,
  forEachChild,
  getModifiers,
  isArrowFunction,
  isAsExpression,
  isBlock,
  isFunctionDeclaration,
  isIdentifier,
  isNonNullExpression,
  isNoSubstitutionTemplateLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isReturnStatement,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isTypeAssertionExpression,
  isVariableStatement,
  type Node,
  type ObjectLiteralElementLike,
  type ObjectLiteralExpression,
  ScriptKind,
  ScriptTarget,
  type Statement,
  SyntaxKind,
  type SourceFile as TypeScriptSourceFile,
} from "typescript";
import type { AuditRule, AuditRuleResult } from "../audit";
import type { ProjectDiscovery } from "../discovery";
import { fail, notApplicable, pass } from "./rule-result";
import {
  getProjectSourceFiles,
  getTextLineNumber,
  readProjectSourceFile,
  type SourceFile,
} from "./source-files";

type MetadataFieldState = "invalid" | "missing" | "unknown" | "valid";

interface MetadataExport {
  description: MetadataFieldState;
  file: SourceFile;
  line: number;
  title: MetadataFieldState;
}

const APP_METADATA_FILE_PATTERN = /^(?:layout|page)\.[cm]?[jt]sx?$/;
const HTML_TITLE_PATTERN = /<title>\s*[^<\s][^<]*<\/title>/i;
const HTML_DESCRIPTION_PATTERN =
  /<meta(?=[^>]*name=["']description["'])(?=[^>]*content=["'][^"']+["'])[^>]*>/i;

const getScriptKind = (filePath: string): ScriptKind => {
  if (filePath.endsWith(".tsx")) {
    return ScriptKind.TSX;
  }

  if (filePath.endsWith(".jsx")) {
    return ScriptKind.JSX;
  }

  return filePath.endsWith(".ts") ? ScriptKind.TS : ScriptKind.JS;
};

const parseSourceFile = (file: SourceFile): TypeScriptSourceFile =>
  createSourceFile(
    file.path,
    file.content,
    ScriptTarget.Latest,
    true,
    getScriptKind(file.path)
  );

const hasExportModifier = (node: Node): boolean =>
  canHaveModifiers(node) &&
  Boolean(
    getModifiers(node)?.some(
      (modifier) => modifier.kind === SyntaxKind.ExportKeyword
    )
  );

const getPropertyName = (node: Node): string | null => {
  if (isIdentifier(node) || isStringLiteral(node)) {
    return node.text;
  }

  return null;
};

const unwrapExpression = (expression: Expression): Expression => {
  let currentExpression = expression;

  while (
    isAsExpression(currentExpression) ||
    isNonNullExpression(currentExpression) ||
    isParenthesizedExpression(currentExpression) ||
    isSatisfiesExpression(currentExpression) ||
    isTypeAssertionExpression(currentExpression)
  ) {
    currentExpression = currentExpression.expression;
  }

  return currentExpression;
};

const getAssignedFieldState = (
  expression: Expression,
  fieldName: string
): MetadataFieldState => {
  const value = unwrapExpression(expression);

  if (isStringLiteral(value) || isNoSubstitutionTemplateLiteral(value)) {
    return value.text.trim().length > 0 ? "valid" : "invalid";
  }

  if (
    value.kind === SyntaxKind.NullKeyword ||
    (isIdentifier(value) && value.text === "undefined")
  ) {
    return "invalid";
  }

  if (fieldName !== "title" || !isObjectLiteralExpression(value)) {
    return "unknown";
  }

  const defaultState = getObjectFieldState(value, "default");
  const absoluteState = getObjectFieldState(value, "absolute");

  if (defaultState === "valid" || absoluteState === "valid") {
    return "valid";
  }

  if (defaultState === "invalid" || absoluteState === "invalid") {
    return "invalid";
  }

  return "unknown";
};

const getPropertyFieldState = (
  property: ObjectLiteralElementLike,
  fieldName: string
): MetadataFieldState | null => {
  if (isShorthandPropertyAssignment(property)) {
    return property.name.text === fieldName ? "unknown" : null;
  }

  if (
    !isPropertyAssignment(property) ||
    getPropertyName(property.name) !== fieldName
  ) {
    return null;
  }

  return getAssignedFieldState(property.initializer, fieldName);
};

function getObjectFieldState(
  object: ObjectLiteralExpression,
  fieldName: string
): MetadataFieldState {
  for (const property of object.properties) {
    const state = getPropertyFieldState(property, fieldName);

    if (state) {
      return state;
    }
  }

  return "missing";
}

const findReturnedObject = (node: Node): ObjectLiteralExpression | null => {
  let returnedObject: ObjectLiteralExpression | null = null;

  const visit = (currentNode: Node): void => {
    if (returnedObject) {
      return;
    }

    if (isReturnStatement(currentNode) && currentNode.expression) {
      const expression = unwrapExpression(currentNode.expression);

      if (isObjectLiteralExpression(expression)) {
        returnedObject = expression;
        return;
      }
    }

    forEachChild(currentNode, visit);
  };

  visit(node);
  return returnedObject;
};

const getMetadataObject = (node: Node): ObjectLiteralExpression | null => {
  if (isArrowFunction(node) && !isBlock(node.body)) {
    const body = unwrapExpression(node.body);

    if (isObjectLiteralExpression(body)) {
      return body;
    }
  }

  return findReturnedObject(node);
};

const createMetadataExport = (
  file: SourceFile,
  sourceFile: TypeScriptSourceFile,
  node: Node,
  object: ObjectLiteralExpression | null
): MetadataExport => ({
  description: object ? getObjectFieldState(object, "description") : "unknown",
  file,
  line:
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1,
  title: object ? getObjectFieldState(object, "title") : "unknown",
});

const getVariableMetadataObject = (
  statement: Statement
): ObjectLiteralExpression | null | undefined => {
  if (!isVariableStatement(statement)) {
    return;
  }

  for (const declaration of statement.declarationList.declarations) {
    if (!(isIdentifier(declaration.name) && declaration.initializer)) {
      continue;
    }

    if (declaration.name.text === "metadata") {
      const initializer = unwrapExpression(declaration.initializer);
      return isObjectLiteralExpression(initializer) ? initializer : null;
    }

    if (declaration.name.text === "generateMetadata") {
      return getMetadataObject(declaration.initializer);
    }
  }
};

const getStatementMetadataObject = (
  statement: Statement
): ObjectLiteralExpression | null | undefined => {
  if (!hasExportModifier(statement)) {
    return;
  }

  if (
    isFunctionDeclaration(statement) &&
    statement.name?.text === "generateMetadata"
  ) {
    return getMetadataObject(statement);
  }

  return getVariableMetadataObject(statement);
};

const findMetadataExport = (file: SourceFile): MetadataExport | null => {
  const sourceFile = parseSourceFile(file);

  for (const statement of sourceFile.statements) {
    const object = getStatementMetadataObject(statement);

    if (object !== undefined) {
      return createMetadataExport(file, sourceFile, statement, object);
    }
  }

  return null;
};

const getMissingFields = (metadata: MetadataExport): string[] => {
  const missing: string[] = [];

  if (metadata.title === "invalid" || metadata.title === "missing") {
    missing.push("title");
  }

  if (
    metadata.description === "invalid" ||
    metadata.description === "missing"
  ) {
    missing.push("description");
  }

  return missing;
};

const getInvalidOverrides = (metadata: MetadataExport): string[] =>
  [
    metadata.title === "invalid" ? "title" : null,
    metadata.description === "invalid" ? "description" : null,
  ].filter((field): field is string => field !== null);

const evaluateRootMetadata = (
  rootMetadata: MetadataExport,
  metadataExports: MetadataExport[]
): AuditRuleResult => {
  const missingRootFields = getMissingFields(rootMetadata);

  if (missingRootFields.length > 0) {
    return fail(
      `Root Next metadata is missing a non-empty ${missingRootFields.join(
        " and "
      )}.`,
      "Add meaningful title and description values to the root metadata export.",
      {
        filePath: rootMetadata.file.path,
        line: rootMetadata.line,
      }
    );
  }

  for (const metadata of metadataExports) {
    if (metadata === rootMetadata) {
      continue;
    }

    const invalidOverrides = getInvalidOverrides(metadata);

    if (invalidOverrides.length > 0) {
      return fail(
        `Next metadata explicitly overrides ${invalidOverrides.join(
          " and "
        )} with an empty value.`,
        "Remove the empty override to inherit root metadata, or provide a meaningful value.",
        {
          filePath: metadata.file.path,
          line: metadata.line,
        }
      );
    }
  }

  return pass(
    "Next routes inherit or provide non-empty title and description metadata.",
    rootMetadata.file.path,
    rootMetadata.line
  );
};

const evaluateMetadataWithoutRoot = (
  metadataExports: MetadataExport[]
): AuditRuleResult => {
  const completeMetadata = metadataExports.find(
    (metadata) => getMissingFields(metadata).length === 0
  );

  if (completeMetadata) {
    return pass(
      "Next metadata includes a non-empty title and description.",
      completeMetadata.file.path,
      completeMetadata.line
    );
  }

  const incompleteMetadata = metadataExports[0];

  if (incompleteMetadata) {
    const missing = getMissingFields(incompleteMetadata);
    return fail(
      `Next metadata is missing a non-empty ${missing.join(" and ")}.`,
      "Add meaningful title and description values to metadata or generateMetadata.",
      {
        filePath: incompleteMetadata.file.path,
        line: incompleteMetadata.line,
      }
    );
  }

  return fail(
    "No complete Next metadata export was found.",
    "Export metadata or generateMetadata with meaningful title and description values."
  );
};

const evaluateNextMetadata = async (
  project: ProjectDiscovery
): Promise<AuditRuleResult> => {
  const appDir = project.paths.appDir;

  if (!appDir) {
    return notApplicable("No Next App Router directory was found.");
  }

  const files = (await getProjectSourceFiles(project))
    .filter(
      (file) =>
        file.path.startsWith(`${appDir}${path.sep}`) &&
        APP_METADATA_FILE_PATTERN.test(path.basename(file.path))
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const metadataExports = files
    .map(findMetadataExport)
    .filter((metadata): metadata is MetadataExport => metadata !== null);
  const rootMetadata = metadataExports.find(
    (metadata) =>
      path.dirname(metadata.file.path) === path.resolve(appDir) &&
      path.basename(metadata.file.path).startsWith("layout.")
  );

  return rootMetadata
    ? evaluateRootMetadata(rootMetadata, metadataExports)
    : evaluateMetadataWithoutRoot(metadataExports);
};

const evaluateHtmlMetadata = async (
  project: ProjectDiscovery
): Promise<AuditRuleResult> => {
  const indexPath = path.join(project.rootDir, "index.html");
  const document = await readProjectSourceFile(project, indexPath);

  if (!document) {
    return notApplicable("No HTML document entry file was found.");
  }

  const hasTitle = HTML_TITLE_PATTERN.test(document.content);
  const hasDescription = HTML_DESCRIPTION_PATTERN.test(document.content);

  if (hasTitle && hasDescription) {
    return pass(
      "HTML metadata includes a non-empty title and description.",
      indexPath,
      getTextLineNumber(document.content, HTML_TITLE_PATTERN)
    );
  }

  return fail(
    "The HTML document is missing a non-empty title or description.",
    "Add a meaningful title element and description meta tag.",
    { filePath: indexPath }
  );
};

const metadataTitleDescriptionCompleteRule: AuditRule = {
  adapters: ["core"],
  category: "production-polish",
  confidence: "high",
  description: "Checks for non-empty document title and description metadata.",
  id: "metadata-title-description-complete",
  maxScore: 3,
  run: ({ project }) => {
    if (project.framework.adapter === "next-app-router") {
      return evaluateNextMetadata(project);
    }

    return evaluateHtmlMetadata(project);
  },
  severity: "warning",
  title: "metadata title and description are complete",
};

export { metadataTitleDescriptionCompleteRule };
