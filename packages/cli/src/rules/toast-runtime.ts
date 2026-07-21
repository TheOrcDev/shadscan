import path from "node:path";
import {
  type CompilerOptions,
  createSourceFile,
  forEachChild,
  getParsedCommandLineOfConfigFile,
  isIdentifier,
  isImportDeclaration,
  isJsxOpeningElement,
  isJsxSelfClosingElement,
  isNamedImports,
  isNamespaceImport,
  isStringLiteral,
  type Node,
  resolveModuleName,
  ScriptKind,
  ScriptTarget,
  type SourceFile as TypeScriptSourceFile,
} from "typescript";
import type { ProjectDiscovery } from "../discovery";
import {
  type ConfinedTypeScriptHost,
  createConfinedTypeScriptHost,
} from "../typescript-host";
import {
  getProjectSourceFiles,
  readProjectSourceFile,
  type SourceFile,
} from "./source-files";

interface ImportBinding {
  importedName: string;
  localName: string;
}

interface ImportReference {
  bindings: ImportBinding[];
  line: number;
  moduleName: string;
}

interface ToastEvidence {
  filePath: string;
  line: number;
}

interface ToastRuntimeEvidence extends ToastEvidence {
  moduleName: string;
}

interface ToastRuntimeAnalysis {
  hasDependency: boolean;
  mount: (ToastEvidence & { componentName: string }) | null;
  runtime: ToastRuntimeEvidence | null;
  shell: SourceFile | null;
}

interface ParsedProjectFile {
  file: SourceFile;
  sourceFile: TypeScriptSourceFile;
}

const MAX_LOCAL_IMPORT_DEPTH = 3;
const SCRIPT_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const TOAST_NAME_PATTERN = /(?:sonner|toast)/i;
const TOAST_DEPENDENCIES = [
  "@radix-ui/react-toast",
  "radix-ui",
  "react-hot-toast",
  "sonner",
] as const;
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
const analysisCache = new WeakMap<
  ProjectDiscovery,
  Map<string, Promise<ToastRuntimeAnalysis>>
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

const getLineNumber = (sourceFile: TypeScriptSourceFile, node: Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const walkNodes = (node: Node, visitor: (node: Node) => unknown): void => {
  if (visitor(node) === false) {
    return;
  }

  forEachChild(node, (child) => {
    walkNodes(child, visitor);
  });
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

    const bindings: ImportBinding[] = [];
    const importClause = statement.importClause;

    if (importClause?.name) {
      bindings.push({
        importedName: "default",
        localName: importClause.name.text,
      });
    }

    const namedBindings = importClause?.namedBindings;

    if (namedBindings && isNamespaceImport(namedBindings)) {
      bindings.push({ importedName: "*", localName: namedBindings.name.text });
    } else if (namedBindings && isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        bindings.push({
          importedName: element.propertyName?.text ?? element.name.text,
          localName: element.name.text,
        });
      }
    }

    references.push({
      bindings,
      line: getLineNumber(sourceFile, statement),
      moduleName: statement.moduleSpecifier.text,
    });
  }

  return references;
};

const getReferencedIdentifiers = (
  sourceFile: TypeScriptSourceFile
): Set<string> => {
  const identifiers = new Set<string>();

  walkNodes(sourceFile, (node) => {
    if (isImportDeclaration(node)) {
      return false;
    }

    if (isIdentifier(node)) {
      identifiers.add(node.text);
    }

    return true;
  });

  return identifiers;
};

const getRenderedBindings = (
  sourceFile: TypeScriptSourceFile
): Map<string, number> => {
  const renderedBindings = new Map<string, number>();

  walkNodes(sourceFile, (node) => {
    if (!(isJsxOpeningElement(node) || isJsxSelfClosingElement(node))) {
      return;
    }

    const rootName = node.tagName.getText(sourceFile).split(".")[0];

    if (rootName) {
      renderedBindings.set(rootName, getLineNumber(sourceFile, node));
    }
  });

  return renderedBindings;
};

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

const isRuntimeImport = (
  reference: ImportReference,
  referencedIdentifiers: Set<string>,
  project: ProjectDiscovery
): boolean => {
  if (!project.dependencies[reference.moduleName]) {
    return false;
  }

  const usedBindings = reference.bindings.filter((binding) =>
    referencedIdentifiers.has(binding.localName)
  );

  if (reference.moduleName === "radix-ui") {
    return usedBindings.some((binding) => binding.importedName === "Toast");
  }

  if (reference.moduleName === "@radix-ui/react-toast") {
    return usedBindings.some((binding) =>
      ["*", "Provider", "ToastProvider", "Viewport"].includes(
        binding.importedName
      )
    );
  }

  if (
    reference.moduleName === "sonner" ||
    reference.moduleName === "react-hot-toast"
  ) {
    return usedBindings.some((binding) => binding.importedName === "Toaster");
  }

  return false;
};

const findRuntimeThroughLocalImports = (
  currentFile: ParsedProjectFile,
  project: ProjectDiscovery,
  compilerOptions: CompilerOptions,
  host: ConfinedTypeScriptHost,
  filesByPath: Map<string, ParsedProjectFile>,
  visitedFiles: Set<string>,
  depth: number
): ToastRuntimeEvidence | null => {
  const currentPath = path.resolve(currentFile.file.path);

  if (visitedFiles.has(currentPath)) {
    return null;
  }

  visitedFiles.add(currentPath);
  const imports = getImportReferences(currentFile.sourceFile);
  const referencedIdentifiers = getReferencedIdentifiers(
    currentFile.sourceFile
  );

  for (const reference of imports) {
    if (isRuntimeImport(reference, referencedIdentifiers, project)) {
      return {
        filePath: currentFile.file.path,
        line: reference.line,
        moduleName: reference.moduleName,
      };
    }
  }

  if (depth >= MAX_LOCAL_IMPORT_DEPTH) {
    return null;
  }

  for (const reference of imports) {
    const importIsUsed = reference.bindings.some((binding) =>
      referencedIdentifiers.has(binding.localName)
    );

    if (!importIsUsed) {
      continue;
    }

    const localFile = resolveLocalImport(
      reference.moduleName,
      currentFile.file.path,
      project,
      compilerOptions,
      host,
      filesByPath
    );

    if (!localFile) {
      continue;
    }

    const runtime = findRuntimeThroughLocalImports(
      localFile,
      project,
      compilerOptions,
      host,
      filesByPath,
      visitedFiles,
      depth + 1
    );

    if (runtime) {
      return runtime;
    }
  }

  return null;
};

const getShellPaths = (project: ProjectDiscovery): string[] => {
  const shellPaths: string[] = [];

  if (project.versions.next && project.paths.appDir) {
    shellPaths.push(
      ...["layout.tsx", "layout.jsx", "layout.ts", "layout.js"].map(
        (fileName) => path.join(project.paths.appDir ?? "", fileName)
      )
    );
  }

  if (project.versions.next && project.paths.pagesDir) {
    shellPaths.push(
      ...["_app.tsx", "_app.jsx", "_app.ts", "_app.js"].map((fileName) =>
        path.join(project.paths.pagesDir ?? "", fileName)
      )
    );
  }

  if (shellPaths.length > 0) {
    return shellPaths;
  }

  if (project.paths.viteEntry) {
    return [project.paths.viteEntry];
  }

  return ["src/main.tsx", "src/main.jsx", "src/App.tsx", "src/App.jsx"].map(
    (fileName) => path.join(project.rootDir, fileName)
  );
};

const readShells = async (project: ProjectDiscovery): Promise<SourceFile[]> => {
  const shells: SourceFile[] = [];

  for (const shellPath of getShellPaths(project)) {
    const shell = await readProjectSourceFile(project, shellPath);

    if (shell) {
      shells.push(shell);
    }
  }

  return shells;
};

interface ToastShellContext {
  compilerOptions: CompilerOptions;
  filesByPath: Map<string, ParsedProjectFile>;
  hasDependency: boolean;
  host: ConfinedTypeScriptHost;
  project: ProjectDiscovery;
}

const analyzeToastShell = (
  shell: SourceFile,
  context: ToastShellContext
): ToastRuntimeAnalysis | null => {
  const { compilerOptions, filesByPath, hasDependency, host, project } =
    context;
  const parsedShell =
    filesByPath.get(path.resolve(shell.path)) ?? parseSourceFile(shell);
  const renderedBindings = getRenderedBindings(parsedShell.sourceFile);

  for (const reference of getImportReferences(parsedShell.sourceFile)) {
    for (const binding of reference.bindings) {
      const mountLine = renderedBindings.get(binding.localName);
      const isToastMount =
        TOAST_NAME_PATTERN.test(binding.localName) ||
        TOAST_NAME_PATTERN.test(binding.importedName);

      if (!(mountLine && isToastMount)) {
        continue;
      }

      const mount = {
        componentName: binding.localName,
        filePath: shell.path,
        line: mountLine,
      };
      const shellIdentifiers = getReferencedIdentifiers(parsedShell.sourceFile);

      if (isRuntimeImport(reference, shellIdentifiers, project)) {
        return {
          hasDependency,
          mount,
          runtime: {
            filePath: shell.path,
            line: reference.line,
            moduleName: reference.moduleName,
          },
          shell,
        };
      }

      const localFile = resolveLocalImport(
        reference.moduleName,
        shell.path,
        project,
        compilerOptions,
        host,
        filesByPath
      );

      if (!localFile) {
        continue;
      }

      const runtime = findRuntimeThroughLocalImports(
        localFile,
        project,
        compilerOptions,
        host,
        filesByPath,
        new Set<string>(),
        1
      );

      if (runtime) {
        return { hasDependency, mount, runtime, shell };
      }
    }
  }

  return null;
};

const runToastRuntimeAnalysis = async (
  project: ProjectDiscovery,
  filesystemRoot: string
): Promise<ToastRuntimeAnalysis> => {
  const host = createConfinedTypeScriptHost(filesystemRoot);
  const hasDependency = TOAST_DEPENDENCIES.some(
    (dependency) => project.dependencies[dependency]
  );
  const shells = await readShells(project);
  const firstShell = shells[0] ?? null;

  if (!(hasDependency && firstShell)) {
    return { hasDependency, mount: null, runtime: null, shell: firstShell };
  }

  const sourceFiles = await getProjectSourceFiles(project);
  const parsedFiles = sourceFiles
    .filter((file) => SCRIPT_FILE_PATTERN.test(file.path))
    .map(parseSourceFile);
  const filesByPath = new Map(
    parsedFiles.map((file) => [path.resolve(file.file.path), file])
  );
  const compilerOptions = getCompilerOptions(project, host);
  const context = {
    compilerOptions,
    filesByPath,
    hasDependency,
    host,
    project,
  };

  for (const shell of shells) {
    if (!SCRIPT_FILE_PATTERN.test(shell.path)) {
      continue;
    }

    const analysis = analyzeToastShell(shell, context);

    if (analysis) {
      return analysis;
    }
  }

  return { hasDependency, mount: null, runtime: null, shell: firstShell };
};

const analyzeToastRuntime = (
  project: ProjectDiscovery,
  filesystemRoot: string
): Promise<ToastRuntimeAnalysis> => {
  const cacheKey = path.resolve(filesystemRoot);
  const projectCache = analysisCache.get(project) ?? new Map();
  const cachedAnalysis = projectCache.get(cacheKey);

  if (cachedAnalysis) {
    return cachedAnalysis;
  }

  const analysis = runToastRuntimeAnalysis(project, filesystemRoot);
  projectCache.set(cacheKey, analysis);
  analysisCache.set(project, projectCache);
  return analysis;
};

export type { ToastRuntimeAnalysis };
export { analyzeToastRuntime };
