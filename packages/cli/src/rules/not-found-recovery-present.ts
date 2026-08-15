import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type CompilerOptions,
  createSourceFile,
  forEachChild,
  getParsedCommandLineOfConfigFile,
  isImportDeclaration,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isNamedImports,
  isStringLiteral,
  type Node,
  resolveModuleName,
  ScriptKind,
  ScriptTarget,
} from "typescript";
import type { AuditRule } from "../audit";
import type { ProjectDiscovery } from "../discovery";
import {
  type ConfinedTypeScriptHost,
  createConfinedTypeScriptHost,
} from "../typescript-host";
import { fail, notApplicable, pass } from "./rule-result";
import { findProjectFiles, getTextLineNumber } from "./source-files";

const RECOVERY_CONTROL_PATTERN =
  /<(?:a|Link)\b[^>]*href=|<(?:button|Button)\b[^>]*onClick\s*=\s*\{[^}]*(?:back|push|replace)|<(?:form|Search|SearchInput)(?:\s|>)/i;
const NOT_FOUND_COMPONENT_PATTERN = /export\s+default/;
const MAX_RENDERED_COMPONENT_FILES = 32;

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

const getRenderedImportSpecifiers = (
  content: string,
  filePath: string
): string[] => {
  const sourceFile = createSourceFile(
    filePath,
    content,
    ScriptTarget.Latest,
    true,
    ScriptKind.TSX
  );
  const componentImports = new Map<string, string>();

  for (const statement of sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        statement.importClause
      ) ||
      statement.importClause.isTypeOnly
    ) {
      continue;
    }

    const moduleSpecifier = statement.moduleSpecifier.text;
    const importClause = statement.importClause;

    if (importClause.name) {
      componentImports.set(importClause.name.text, moduleSpecifier);
    }

    const namedBindings = importClause.namedBindings;
    if (namedBindings && isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        if (!element.isTypeOnly) {
          componentImports.set(element.name.text, moduleSpecifier);
        }
      }
    } else if (namedBindings) {
      componentImports.set(namedBindings.name.text, moduleSpecifier);
    }
  }

  const renderedSpecifiers = new Set<string>();
  const visit = (node: Node): void => {
    if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
      const localName = node.tagName.getText(sourceFile).split(".")[0];
      const moduleSpecifier = localName
        ? componentImports.get(localName)
        : undefined;

      if (moduleSpecifier) {
        renderedSpecifiers.add(moduleSpecifier);
      }
    }

    forEachChild(node, visit);
  };
  visit(sourceFile);

  return [...renderedSpecifiers];
};

const resolveProjectModule = (
  moduleSpecifier: string,
  containingFile: string,
  projectRoot: string,
  compilerOptions: CompilerOptions,
  host: ConfinedTypeScriptHost
): string | null => {
  const resolvedFile = resolveModuleName(
    moduleSpecifier,
    containingFile,
    compilerOptions,
    host
  ).resolvedModule?.resolvedFileName;

  if (!(resolvedFile && host.isPathAllowed(resolvedFile))) {
    return null;
  }

  const relativePath = path.relative(projectRoot, resolvedFile);
  const isProjectFile = !(
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    relativePath.split(path.sep).includes("node_modules")
  );

  return isProjectFile ? resolvedFile : null;
};

const hasRecoveryInRenderedTree = async ({
  compilerOptions,
  filePath,
  host,
  projectRoot,
  visited,
}: {
  compilerOptions: CompilerOptions;
  filePath: string;
  host: ConfinedTypeScriptHost;
  projectRoot: string;
  visited: Set<string>;
}): Promise<boolean> => {
  if (visited.has(filePath) || visited.size >= MAX_RENDERED_COMPONENT_FILES) {
    return false;
  }

  visited.add(filePath);
  const content = await readFile(filePath, "utf8");

  if (RECOVERY_CONTROL_PATTERN.test(content)) {
    return true;
  }

  const moduleSpecifiers = getRenderedImportSpecifiers(content, filePath);
  for (const moduleSpecifier of moduleSpecifiers) {
    const resolvedFile = resolveProjectModule(
      moduleSpecifier,
      filePath,
      projectRoot,
      compilerOptions,
      host
    );

    if (
      resolvedFile &&
      (await hasRecoveryInRenderedTree({
        compilerOptions,
        filePath: resolvedFile,
        host,
        projectRoot,
        visited,
      }))
    ) {
      return true;
    }
  }

  return false;
};

const notFoundRecoveryPresentRule: AuditRule = {
  adapters: ["next-app-router", "next-hybrid-router", "next-pages-router"],
  category: "states",
  confidence: "high",
  description:
    "Checks Next not-found UI and rendered local components for a navigation or search recovery path.",
  id: "not-found-recovery-present",
  maxScore: 3,
  run: async ({ filesystemRoot, project }) => {
    const patterns: string[] = [];

    if (project.paths.appDir) {
      const relativeAppDir = path.relative(
        project.rootDir,
        project.paths.appDir
      );
      patterns.push(
        path.join(relativeAppDir, "not-found.{js,jsx,ts,tsx}"),
        path.join(relativeAppDir, "**/not-found.{js,jsx,ts,tsx}")
      );
    }

    if (project.paths.pagesDir) {
      const relativePagesDir = path.relative(
        project.rootDir,
        project.paths.pagesDir
      );
      patterns.push(path.join(relativePagesDir, "404.{js,jsx,ts,tsx}"));
    }

    if (patterns.length === 0) {
      return notApplicable("No supported Next route directory was found.");
    }

    const notFoundFiles = await findProjectFiles(project, patterns);

    if (notFoundFiles.length === 0) {
      return notApplicable("No Next not-found UI file was found.");
    }

    const host = createConfinedTypeScriptHost(filesystemRoot);
    const compilerOptions = getCompilerOptions(project, host);

    for (const filePath of notFoundFiles) {
      const content = await readFile(filePath, "utf8");

      if (
        await hasRecoveryInRenderedTree({
          compilerOptions,
          filePath,
          host,
          projectRoot: project.rootDir,
          visited: new Set<string>(),
        })
      ) {
        continue;
      }

      return fail(
        "Not-found UI has no navigation, back, or search recovery action.",
        "Add a link home, a back action, or a search control to the not-found state.",
        {
          filePath,
          line: getTextLineNumber(content, NOT_FOUND_COMPONENT_PATTERN),
        }
      );
    }

    return pass(
      `All ${notFoundFiles.length} not-found surfaces offer recovery.`
    );
  },
  severity: "warning",
  title: "not-found states provide recovery",
};

export { notFoundRecoveryPresentRule };
