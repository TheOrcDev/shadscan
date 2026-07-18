import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  canHaveModifiers,
  createSourceFile,
  type FunctionDeclaration,
  forEachChild,
  getModifiers,
  isAwaitExpression,
  isCallExpression,
  isExportAssignment,
  isFunctionDeclaration,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isNumericLiteral,
  isObjectBindingPattern,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableStatement,
  type Node,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
  type SourceFile as TypeScriptSourceFile,
} from "typescript";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";
import { fileExists, findFiles } from "./source-files";

interface DynamicRouteEvidence {
  line: number;
  signal: string;
}

const SUSPENSE_FALLBACK_PATTERN = /<Suspense\b[^>]*\bfallback=/;
const REQUEST_API_IMPORTS = new Set([
  "connection",
  "cookies",
  "draftMode",
  "headers",
]);

const getScriptKind = (filePath: string): ScriptKind => {
  if (filePath.endsWith(".tsx")) {
    return ScriptKind.TSX;
  }

  if (filePath.endsWith(".jsx")) {
    return ScriptKind.JSX;
  }

  return filePath.endsWith(".ts") ? ScriptKind.TS : ScriptKind.JS;
};

const getLineNumber = (sourceFile: TypeScriptSourceFile, node: Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const hasModifier = (node: Node, kind: SyntaxKind): boolean =>
  canHaveModifiers(node) &&
  Boolean(getModifiers(node)?.some((modifier) => modifier.kind === kind));

const getExplicitDynamicEvidence = (
  sourceFile: TypeScriptSourceFile
): DynamicRouteEvidence | null => {
  for (const statement of sourceFile.statements) {
    if (
      !(
        isVariableStatement(statement) &&
        hasModifier(statement, SyntaxKind.ExportKeyword)
      )
    ) {
      continue;
    }

    for (const declaration of statement.declarationList.declarations) {
      if (!(isIdentifier(declaration.name) && declaration.initializer)) {
        continue;
      }

      if (
        declaration.name.text === "dynamic" &&
        isStringLiteral(declaration.initializer) &&
        declaration.initializer.text === "force-dynamic"
      ) {
        return {
          line: getLineNumber(sourceFile, declaration),
          signal: 'dynamic = "force-dynamic"',
        };
      }

      if (
        declaration.name.text === "revalidate" &&
        isNumericLiteral(declaration.initializer) &&
        Number(declaration.initializer.text) === 0
      ) {
        return {
          line: getLineNumber(sourceFile, declaration),
          signal: "revalidate = 0",
        };
      }
    }
  }

  return null;
};

const getRequestApiBindings = (
  sourceFile: TypeScriptSourceFile
): Set<string> => {
  const bindings = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        ["next/headers", "next/server"].includes(statement.moduleSpecifier.text)
      )
    ) {
      continue;
    }

    const namedBindings = statement.importClause?.namedBindings;

    if (!(namedBindings && isNamedImports(namedBindings))) {
      continue;
    }

    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;

      if (REQUEST_API_IMPORTS.has(importedName)) {
        bindings.add(element.name.text);
      }
    }
  }

  return bindings;
};

const getDefaultPageFunction = (
  sourceFile: TypeScriptSourceFile
): FunctionDeclaration | null => {
  for (const statement of sourceFile.statements) {
    if (
      isFunctionDeclaration(statement) &&
      hasModifier(statement, SyntaxKind.ExportKeyword) &&
      hasModifier(statement, SyntaxKind.DefaultKeyword)
    ) {
      return statement;
    }
  }

  const defaultExport = sourceFile.statements.find(isExportAssignment);

  if (!(defaultExport && isIdentifier(defaultExport.expression))) {
    return null;
  }

  const defaultExportName = defaultExport.expression.text;

  return (
    sourceFile.statements.find(
      (statement): statement is FunctionDeclaration =>
        isFunctionDeclaration(statement) &&
        statement.name?.text === defaultExportName
    ) ?? null
  );
};

const getSearchParamsBindings = (
  pageFunction: FunctionDeclaration
): { direct: Set<string>; props: Set<string> } => {
  const direct = new Set<string>();
  const props = new Set<string>();
  const firstParameter = pageFunction.parameters[0];

  if (!firstParameter) {
    return { direct, props };
  }

  if (isIdentifier(firstParameter.name)) {
    props.add(firstParameter.name.text);
    return { direct, props };
  }

  if (!isObjectBindingPattern(firstParameter.name)) {
    return { direct, props };
  }

  for (const element of firstParameter.name.elements) {
    const propertyName = element.propertyName;
    let sourceName: string | null = null;

    if (
      propertyName &&
      (isIdentifier(propertyName) || isStringLiteral(propertyName))
    ) {
      sourceName = propertyName.text;
    } else if (isIdentifier(element.name)) {
      sourceName = element.name.text;
    }

    if (sourceName === "searchParams" && isIdentifier(element.name)) {
      direct.add(element.name.text);
    }
  }

  return { direct, props };
};

const getCallDynamicEvidence = (
  node: Node,
  sourceFile: TypeScriptSourceFile,
  requestApiBindings: Set<string>,
  searchParamsBindings: Set<string>
): DynamicRouteEvidence | null => {
  if (!(isCallExpression(node) && isIdentifier(node.expression))) {
    return null;
  }

  if (requestApiBindings.has(node.expression.text)) {
    return {
      line: getLineNumber(sourceFile, node),
      signal: `${node.expression.text}()`,
    };
  }

  const consumesSearchParams =
    node.expression.text === "use" &&
    node.arguments.some(
      (argument) =>
        isIdentifier(argument) && searchParamsBindings.has(argument.text)
    );

  return consumesSearchParams
    ? {
        line: getLineNumber(sourceFile, node),
        signal: "searchParams consumption",
      }
    : null;
};

const getAwaitDynamicEvidence = (
  node: Node,
  sourceFile: TypeScriptSourceFile,
  searchParamsBindings: { direct: Set<string>; props: Set<string> }
): DynamicRouteEvidence | null => {
  if (!isAwaitExpression(node)) {
    return null;
  }

  const awaitsDirectBinding =
    isIdentifier(node.expression) &&
    searchParamsBindings.direct.has(node.expression.text);
  const awaitsPropsBinding =
    isPropertyAccessExpression(node.expression) &&
    isIdentifier(node.expression.expression) &&
    searchParamsBindings.props.has(node.expression.expression.text) &&
    node.expression.name.text === "searchParams";

  return awaitsDirectBinding || awaitsPropsBinding
    ? {
        line: getLineNumber(sourceFile, node),
        signal: "searchParams consumption",
      }
    : null;
};

const getPageDynamicEvidence = (
  sourceFile: TypeScriptSourceFile
): DynamicRouteEvidence | null => {
  const explicitEvidence = getExplicitDynamicEvidence(sourceFile);

  if (explicitEvidence) {
    return explicitEvidence;
  }

  const pageFunction = getDefaultPageFunction(sourceFile);

  if (!pageFunction?.body) {
    return null;
  }

  const requestApiBindings = getRequestApiBindings(sourceFile);
  const searchParamsBindings = getSearchParamsBindings(pageFunction);
  let evidence: DynamicRouteEvidence | null = null;

  const visit = (node: Node): void => {
    if (evidence) {
      return;
    }

    evidence =
      getCallDynamicEvidence(
        node,
        sourceFile,
        requestApiBindings,
        searchParamsBindings.direct
      ) ?? getAwaitDynamicEvidence(node, sourceFile, searchParamsBindings);

    if (!evidence) {
      forEachChild(node, visit);
    }
  };

  visit(pageFunction.body);
  return evidence;
};

const hasNearestLoadingFile = async (
  pagePath: string,
  appDir: string
): Promise<boolean> => {
  let currentDir = path.dirname(pagePath);
  const resolvedAppDir = path.resolve(appDir);

  while (currentDir.startsWith(resolvedAppDir)) {
    for (const extension of ["tsx", "jsx", "ts", "js"]) {
      if (await fileExists(path.join(currentDir, `loading.${extension}`))) {
        return true;
      }
    }

    if (currentDir === resolvedAppDir) {
      break;
    }

    currentDir = path.dirname(currentDir);
  }

  return false;
};

const routeLoadingBoundaryPresentRule: AuditRule = {
  adapters: ["next-app-router"],
  category: "states",
  confidence: "medium",
  description:
    "Checks runtime-dynamic Next pages for a route loading file or inline Suspense fallback.",
  id: "route-loading-boundary-present",
  maxScore: 4,
  run: async ({ project }) => {
    const appDir = project.paths.appDir;

    if (!appDir) {
      return notApplicable("No Next App Router directory was found.");
    }

    const relativeAppDir = path.relative(project.rootDir, appDir);
    const pagePaths = (
      await findFiles(project.rootDir, [
        path.join(relativeAppDir, "**/page.{js,jsx,ts,tsx}"),
        path.join(relativeAppDir, "page.{js,jsx,ts,tsx}"),
      ])
    ).sort((left, right) => left.localeCompare(right));
    let dynamicRouteCount = 0;

    for (const pagePath of pagePaths) {
      const content = await readFile(pagePath, "utf8");
      const sourceFile = createSourceFile(
        pagePath,
        content,
        ScriptTarget.Latest,
        true,
        getScriptKind(pagePath)
      );
      const dynamicEvidence = getPageDynamicEvidence(sourceFile);

      if (!dynamicEvidence) {
        continue;
      }

      dynamicRouteCount += 1;

      if (
        SUSPENSE_FALLBACK_PATTERN.test(content) ||
        (await hasNearestLoadingFile(pagePath, appDir))
      ) {
        continue;
      }

      return fail(
        `Runtime-dynamic route has no loading coverage (${dynamicEvidence.signal}).`,
        "Add a loading.tsx boundary in the route segment or wrap dynamic content in Suspense with a useful fallback.",
        {
          filePath: pagePath,
          line: dynamicEvidence.line,
          roast: "A blank screen is not suspense. It is a hostage situation.",
        }
      );
    }

    if (dynamicRouteCount === 0) {
      return notApplicable(
        "No statically identifiable runtime-dynamic Next pages were found."
      );
    }

    return pass(
      `All ${dynamicRouteCount} runtime-dynamic routes have loading coverage.`
    );
  },
  severity: "warning",
  title: "runtime-dynamic routes have loading boundaries",
};

export { routeLoadingBoundaryPresentRule };
