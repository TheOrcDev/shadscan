import path from "node:path";
import {
  createSourceFile,
  isImportDeclaration,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isNamedImports,
  isNamespaceImport,
  isStringLiteral,
  ScriptKind,
  ScriptTarget,
  type SourceFile as TypeScriptSourceFile,
} from "typescript";
import { walkNodes } from "../ast";
import type { ProjectDiscovery } from "../discovery";
import { getLocalReExports } from "./local-re-exports";
import {
  getProjectModuleResolver,
  type ProjectModuleResolver,
  resolveProjectModulePath,
} from "./module-resolution";
import { getProjectSourceFiles, type SourceFile } from "./source-files";

interface ImportReference {
  importedNames: Map<string, string>;
  localNames: string[];
  moduleName: string;
}

interface ParsedProjectFile {
  file: SourceFile;
  sourceFile: TypeScriptSourceFile;
}

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
    const importedNames = new Map<string, string>();
    const importClause = statement.importClause;

    if (importClause?.name) {
      localNames.push(importClause.name.text);
      importedNames.set(importClause.name.text, "default");
    }

    const namedBindings = importClause?.namedBindings;

    if (namedBindings && isNamespaceImport(namedBindings)) {
      localNames.push(namedBindings.name.text);
      importedNames.set(namedBindings.name.text, "*");
    } else if (namedBindings && isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        localNames.push(element.name.text);
        importedNames.set(
          element.name.text,
          (element.propertyName ?? element.name).text
        );
      }
    }

    references.push({
      localNames,
      importedNames,
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

const resolveLocalImport = (
  moduleName: string,
  containingFile: string,
  project: ProjectDiscovery,
  resolver: ProjectModuleResolver,
  filesByPath: Map<string, ParsedProjectFile>
): ParsedProjectFile | null => {
  const resolvedPath = resolveProjectModulePath({
    containingFile,
    hasCandidate: (candidate) => filesByPath.has(candidate),
    moduleName,
    project,
    resolver,
  });

  return resolvedPath ? (filesByPath.get(resolvedPath) ?? null) : null;
};

const getShellCandidates = (project: ProjectDiscovery): string[] => {
  const candidates: string[] = [];

  if (project.versions.next && project.paths.appDir) {
    candidates.push(
      ...["layout.tsx", "layout.jsx", "layout.ts", "layout.js"].map(
        (fileName) => path.join(project.paths.appDir ?? "", fileName)
      )
    );
  }

  if (project.versions.next && project.paths.pagesDir) {
    candidates.push(
      ...["_app.tsx", "_app.jsx", "_app.ts", "_app.js"].map((fileName) =>
        path.join(project.paths.pagesDir ?? "", fileName)
      )
    );
  }

  if (project.versions.tanstackStart && project.paths.routesDir) {
    candidates.push(
      ...["__root.tsx", "__root.jsx", "__root.ts", "__root.js"].map(
        (fileName) => path.join(project.paths.routesDir ?? "", fileName)
      )
    );
  }

  if (project.paths.reactRouterRoot) {
    candidates.push(project.paths.reactRouterRoot);
  }

  if (project.versions.inertia && project.paths.inertiaPagesDir) {
    candidates.push(
      ...[
        "resources/js/app.tsx",
        "resources/js/app.jsx",
        "resources/js/ssr.tsx",
        "resources/js/layouts/app-layout.tsx",
        "resources/js/Layouts/AppLayout.tsx",
      ].map((fileName) => path.join(project.rootDir, fileName))
    );
  }

  if (candidates.length > 0) {
    return candidates;
  }

  if (project.paths.viteEntry) {
    return [project.paths.viteEntry];
  }

  return ["src/main.tsx", "src/main.jsx", "src/App.tsx", "src/App.jsx"].map(
    (fileName) => path.join(project.rootDir, fileName)
  );
};

const LAYOUT_FILE_PATTERN = /(?:^|[/\\])layout\.[jt]sx?$/;
const appendNestedLayouts = (
  project: ProjectDiscovery,
  sourceFiles: SourceFile[],
  candidates: string[]
): void => {
  if (project.versions.next && project.paths.appDir) {
    for (const file of sourceFiles) {
      const relative = path.relative(project.paths.appDir, file.path);
      if (!relative.startsWith("..") && LAYOUT_FILE_PATTERN.test(relative)) {
        candidates.push(file.path);
      }
    }
  }
};

const findMountedComponentFiles = async (
  project: ProjectDiscovery,
  filesystemRoot: string
): Promise<Set<string>> => {
  const resolver = getProjectModuleResolver(project, filesystemRoot);
  const sourceFiles = await getProjectSourceFiles(project);
  const parsedFiles = sourceFiles
    .filter((file) => SCRIPT_FILE_PATTERN.test(file.path))
    .map(parseSourceFile);
  const filesByPath = new Map(
    parsedFiles.map((file) => [path.resolve(file.file.path), file])
  );
  const shellCandidates = getShellCandidates(project);
  appendNestedLayouts(project, sourceFiles, shellCandidates);
  const pendingFiles = shellCandidates
    .map((candidate) => filesByPath.get(path.resolve(candidate)))
    .filter((file): file is ParsedProjectFile => Boolean(file))
    .map((file) => ({
      file,
      names: new Set(project.versions.next ? ["default"] : ["*"]),
    }));
  const mountedFiles = new Set<string>();
  const visited = new Set<string>();

  while (pendingFiles.length > 0) {
    const current = pendingFiles.shift();
    if (!current) {
      continue;
    }

    const currentFile = current.file;
    const currentPath = path.resolve(currentFile.file.path);

    const visitKey = `${currentPath}:${[...current.names].sort().join(",")}`;
    if (visited.has(visitKey)) {
      continue;
    }

    visited.add(visitKey);
    mountedFiles.add(currentPath);
    for (const { moduleName, names } of getLocalReExports(
      currentFile.sourceFile,
      current.names
    )) {
      const file = resolveLocalImport(
        moduleName,
        currentPath,
        project,
        resolver,
        filesByPath
      );
      if (file) {
        pendingFiles.push({ file, names });
      }
    }
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
        resolver,
        filesByPath
      );

      if (importedFile) {
        pendingFiles.push({
          file: importedFile,
          names: new Set(
            reference.localNames
              .filter((name) => renderedBindings.has(name))
              .flatMap((name) => {
                const imported = reference.importedNames.get(name);
                return imported ? [imported] : [];
              })
          ),
        });
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
