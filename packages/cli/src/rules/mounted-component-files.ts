import path from "node:path";
import {
  type CompilerOptions,
  createSourceFile,
  getParsedCommandLineOfConfigFile,
  isImportDeclaration,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isNamedImports,
  isNamespaceImport,
  isStringLiteral,
  resolveModuleName,
  ScriptKind,
  ScriptTarget,
  type SourceFile as TypeScriptSourceFile,
} from "typescript";
import { walkNodes } from "../ast";
import type { ProjectDiscovery } from "../discovery";
import {
  type ConfinedTypeScriptHost,
  createConfinedTypeScriptHost,
} from "../typescript-host";
import { getProjectSourceFiles, type SourceFile } from "./source-files";

interface ImportReference {
  localNames: string[];
  moduleName: string;
}

interface ParsedProjectFile {
  file: SourceFile;
  sourceFile: TypeScriptSourceFile;
}

const MODULE_CANDIDATE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
] as const;
const SCRIPT_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const mountedFilesCache = new WeakMap<
  ProjectDiscovery,
  Map<string, Promise<Set<string>>>
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

const parseSourceFile = (file: SourceFile): ParsedProjectFile => ({
  file,
  sourceFile: createSourceFile(
    file.path,
    file.content,
    ScriptTarget.Latest,
    true,
    getScriptKind(file.path)
  ),
});

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

const getImportReferences = (
  sourceFile: TypeScriptSourceFile
): ImportReference[] => {
  const references: ImportReference[] = [];

  for (const statement of sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier)
      )
    ) {
      continue;
    }

    const localNames: string[] = [];
    const importClause = statement.importClause;

    if (importClause?.name) {
      localNames.push(importClause.name.text);
    }

    const namedBindings = importClause?.namedBindings;

    if (namedBindings && isNamespaceImport(namedBindings)) {
      localNames.push(namedBindings.name.text);
    } else if (namedBindings && isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        localNames.push(element.name.text);
      }
    }

    references.push({
      localNames,
      moduleName: statement.moduleSpecifier.text,
    });
  }

  return references;
};

const getRenderedBindings = (sourceFile: TypeScriptSourceFile): Set<string> => {
  const renderedBindings = new Set<string>();

  walkNodes(sourceFile, (node) => {
    if (!(isJsxOpeningElement(node) || isJsxSelfClosingElement(node))) {
      return;
    }

    const rootName = node.tagName.getText(sourceFile).split(".")[0];

    if (rootName) {
      renderedBindings.add(rootName);
    }
  });

  return renderedBindings;
};

const getSourceCandidate = (
  candidatePath: string,
  filesByPath: Map<string, ParsedProjectFile>
): ParsedProjectFile | null => {
  for (const suffix of MODULE_CANDIDATE_SUFFIXES) {
    const candidate = filesByPath.get(
      path.resolve(`${candidatePath}${suffix}`)
    );

    if (candidate) {
      return candidate;
    }
  }

  return null;
};

const resolveLocalImport = (
  moduleName: string,
  containingFile: string,
  project: ProjectDiscovery,
  compilerOptions: CompilerOptions,
  host: ConfinedTypeScriptHost,
  filesByPath: Map<string, ParsedProjectFile>
): ParsedProjectFile | null => {
  const resolvedFileName = resolveModuleName(
    moduleName,
    containingFile,
    compilerOptions,
    host
  ).resolvedModule?.resolvedFileName;

  if (
    resolvedFileName &&
    host.isPathAllowed(resolvedFileName) &&
    !resolvedFileName.includes(`${path.sep}node_modules${path.sep}`)
  ) {
    const resolvedFile = filesByPath.get(path.resolve(resolvedFileName));

    if (resolvedFile) {
      return resolvedFile;
    }
  }

  if (moduleName.startsWith(".")) {
    return getSourceCandidate(
      path.resolve(path.dirname(containingFile), moduleName),
      filesByPath
    );
  }

  if (moduleName.startsWith("@/")) {
    return getSourceCandidate(
      path.resolve(project.rootDir, moduleName.slice(2)),
      filesByPath
    );
  }

  return null;
};

const getShellCandidates = (project: ProjectDiscovery): string[] => {
  if (project.paths.appDir) {
    return ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"].map(
      (fileName) => path.join(project.paths.appDir ?? "", fileName)
    );
  }

  if (
    project.framework.adapter === "next-pages-router" &&
    project.paths.pagesDir
  ) {
    return ["_app.tsx", "_app.jsx", "_app.ts", "_app.js"].map((fileName) =>
      path.join(project.paths.pagesDir ?? "", fileName)
    );
  }

  if (project.paths.viteEntry) {
    return [project.paths.viteEntry];
  }

  return ["src/main.tsx", "src/main.jsx", "src/App.tsx", "src/App.jsx"].map(
    (fileName) => path.join(project.rootDir, fileName)
  );
};

const findMountedComponentFiles = async (
  project: ProjectDiscovery,
  filesystemRoot: string
): Promise<Set<string>> => {
  const host = createConfinedTypeScriptHost(filesystemRoot);
  const sourceFiles = await getProjectSourceFiles(project);
  const parsedFiles = sourceFiles
    .filter((file) => SCRIPT_FILE_PATTERN.test(file.path))
    .map(parseSourceFile);
  const filesByPath = new Map(
    parsedFiles.map((file) => [path.resolve(file.file.path), file])
  );
  const compilerOptions = getCompilerOptions(project, host);
  const pendingFiles = getShellCandidates(project)
    .map((candidate) => filesByPath.get(path.resolve(candidate)))
    .filter((file): file is ParsedProjectFile => Boolean(file));
  const mountedFiles = new Set<string>();

  while (pendingFiles.length > 0) {
    const currentFile = pendingFiles.shift();

    if (!currentFile) {
      continue;
    }

    const currentPath = path.resolve(currentFile.file.path);

    if (mountedFiles.has(currentPath)) {
      continue;
    }

    mountedFiles.add(currentPath);
    const renderedBindings = getRenderedBindings(currentFile.sourceFile);

    for (const reference of getImportReferences(currentFile.sourceFile)) {
      if (
        !reference.localNames.some((localName) =>
          renderedBindings.has(localName)
        )
      ) {
        continue;
      }

      const importedFile = resolveLocalImport(
        reference.moduleName,
        currentFile.file.path,
        project,
        compilerOptions,
        host,
        filesByPath
      );

      if (importedFile) {
        pendingFiles.push(importedFile);
      }
    }
  }

  return mountedFiles;
};

const getMountedComponentFilePaths = (
  project: ProjectDiscovery,
  filesystemRoot: string
): Promise<Set<string>> => {
  const cacheKey = path.resolve(filesystemRoot);
  const projectCache = mountedFilesCache.get(project) ?? new Map();
  const cachedFiles = projectCache.get(cacheKey);

  if (cachedFiles) {
    return cachedFiles;
  }

  const mountedFiles = findMountedComponentFiles(project, filesystemRoot);
  projectCache.set(cacheKey, mountedFiles);
  mountedFilesCache.set(project, projectCache);
  return mountedFiles;
};

export { getMountedComponentFilePaths };
