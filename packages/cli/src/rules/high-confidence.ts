import path from "node:path";
import {
  type CallExpression,
  type CompilerOptions,
  getParsedCommandLineOfConfigFile,
  isArrowFunction,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isStringLiteral,
  isVariableDeclaration,
  type Node,
  type ParseConfigFileHost,
  resolveModuleName,
  sys,
} from "typescript";
import {
  findOwnedSourceScopes,
  getSourceScopeMatchLine,
  type ParsedSourceFile,
  parseProjectSourceFiles,
  type SourceScope,
  walkNodes,
} from "../ast";
import type {
  AuditContext,
  AuditEvidence,
  AuditRule,
  AuditRuleResult,
} from "../audit";
import type { ProjectDiscovery } from "../discovery";
import {
  fileExists,
  findFiles,
  findSourceMatch,
  getTextLineNumber,
  readProjectSourceFile,
} from "./source-files";
import { analyzeToastRuntime } from "./toast-runtime";
import { sourceScopeHasTypingTargetGuard } from "./typing-target-guard";

const THEME_PROVIDER_PATTERN = /(<ThemeProvider\b|next-themes|useTheme\()/;
const KEYDOWN_HANDLER_PATTERN = /addEventListener\(["']keydown["']|onKeyDown/;
const DIRECT_THEME_TOGGLE_PATTERN =
  /(?:setTheme\s*\(|classList\.toggle\(["']dark["'])/;
const EXTRACTED_THEME_TOGGLE_NAME_PATTERN = /^toggle\w*Theme\w*$/i;
const D_KEY_PATTERN =
  /key\.toLowerCase\(\)\s*!==\s*["']d["']|key\s*===\s*["']d["']/;
const NEXT_METADATA_PATTERN =
  /export\s+(const\s+metadata|async\s+function\s+generateMetadata|function\s+generateMetadata)/;
const HTML_TITLE_PATTERN = /<title>[^<]+<\/title>/;
const HTML_DESCRIPTION_PATTERN = /<meta\s+name=["']description["']/;
const FAVICON_LINK_PATTERN = /<link\s+rel=["'](?:icon|shortcut icon)["']/;
const ERROR_BOUNDARY_PATTERN =
  /(class\s+\w*ErrorBoundary|function\s+\w*ErrorBoundary|<ErrorBoundary\b|react-error-boundary)/;
const parseConfigHost: ParseConfigFileHost = {
  ...sys,
  onUnRecoverableConfigFileDiagnostic: () => undefined,
};

interface ImportedHelper {
  importedName: string;
  moduleName: string;
}

const getCompilerOptions = (project: ProjectDiscovery): CompilerOptions => {
  if (!project.paths.tsconfig) {
    return {};
  }

  return (
    getParsedCommandLineOfConfigFile(
      project.paths.tsconfig,
      {},
      parseConfigHost
    )?.options ?? {}
  );
};

const nodeContainsIdentifier = (node: Node, name: string): boolean => {
  let found = false;

  walkNodes(node, (child) => {
    if (isIdentifier(child) && child.text === name) {
      found = true;
      return false;
    }

    return true;
  });

  return found;
};

const getExtractedThemeToggleCalls = (scope: SourceScope): CallExpression[] => {
  const calls: CallExpression[] = [];

  walkNodes(scope.file.sourceFile, (node) => {
    if (
      isCallExpression(node) &&
      isIdentifier(node.expression) &&
      EXTRACTED_THEME_TOGGLE_NAME_PATTERN.test(node.expression.text) &&
      node.getStart(scope.file.sourceFile) >= scope.start &&
      node.getEnd() <= scope.end &&
      node.arguments.some((argument) =>
        nodeContainsIdentifier(argument, "setTheme")
      )
    ) {
      calls.push(node);
    }
  });

  return calls;
};

const getFunctionDefinitions = (
  file: ParsedSourceFile,
  name: string
): Node[] => {
  const definitions: Node[] = [];

  walkNodes(file.sourceFile, (node) => {
    if (isFunctionDeclaration(node) && node.name?.text === name) {
      definitions.push(node);
      return;
    }

    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (isArrowFunction(node.initializer) ||
        isFunctionExpression(node.initializer))
    ) {
      definitions.push(node.initializer);
    }
  });

  return definitions;
};

const definitionCallsSetTheme = (
  file: ParsedSourceFile,
  definition: Node
): boolean => {
  let callsSetTheme = false;

  walkNodes(definition, (node) => {
    if (
      isCallExpression(node) &&
      isIdentifier(node.expression) &&
      node.expression.text === "setTheme"
    ) {
      callsSetTheme = true;
      return false;
    }

    return true;
  });

  return callsSetTheme && definition.getSourceFile() === file.sourceFile;
};

const getImportedHelper = (
  file: ParsedSourceFile,
  localName: string
): ImportedHelper | null => {
  const matches: ImportedHelper[] = [];

  for (const statement of file.sourceFile.statements) {
    if (
      !(
        isImportDeclaration(statement) &&
        isStringLiteral(statement.moduleSpecifier) &&
        statement.importClause?.namedBindings &&
        isNamedImports(statement.importClause.namedBindings)
      )
    ) {
      continue;
    }

    for (const element of statement.importClause.namedBindings.elements) {
      if (element.name.text === localName) {
        matches.push({
          importedName: element.propertyName?.text ?? element.name.text,
          moduleName: statement.moduleSpecifier.text,
        });
      }
    }
  }

  return matches.length === 1 ? matches[0] : null;
};

const isWithinProject = (projectRoot: string, filePath: string): boolean => {
  const relativePath = path.relative(projectRoot, filePath);

  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath) &&
    !relativePath.split(path.sep).includes("node_modules")
  );
};

const resolveImportedHelperFile = (
  project: ProjectDiscovery,
  containingFile: ParsedSourceFile,
  moduleName: string,
  compilerOptions: CompilerOptions,
  filesByPath: Map<string, ParsedSourceFile>
): ParsedSourceFile | null => {
  const resolvedFileName = resolveModuleName(
    moduleName,
    containingFile.filePath,
    compilerOptions,
    sys
  ).resolvedModule?.resolvedFileName;

  if (
    !(resolvedFileName && isWithinProject(project.rootDir, resolvedFileName))
  ) {
    return null;
  }

  return filesByPath.get(path.resolve(resolvedFileName)) ?? null;
};

const sourceScopeCallsVerifiedThemeToggle = (
  scope: SourceScope,
  project: ProjectDiscovery,
  compilerOptions: CompilerOptions,
  filesByPath: Map<string, ParsedSourceFile>
): boolean => {
  for (const call of getExtractedThemeToggleCalls(scope)) {
    const localName = call.expression.getText(scope.file.sourceFile);
    const localDefinitions = getFunctionDefinitions(scope.file, localName);

    if (localDefinitions.length === 1) {
      if (definitionCallsSetTheme(scope.file, localDefinitions[0])) {
        return true;
      }
      continue;
    }

    if (localDefinitions.length > 1) {
      continue;
    }

    const importedHelper = getImportedHelper(scope.file, localName);
    if (!importedHelper) {
      continue;
    }

    const helperFile = resolveImportedHelperFile(
      project,
      scope.file,
      importedHelper.moduleName,
      compilerOptions,
      filesByPath
    );
    if (!helperFile) {
      continue;
    }

    const definitions = getFunctionDefinitions(
      helperFile,
      importedHelper.importedName
    );

    if (
      definitions.length === 1 &&
      definitionCallsSetTheme(helperFile, definitions[0])
    ) {
      return true;
    }
  }

  return false;
};

const evidence = (
  message: string,
  filePath?: string,
  line?: number
): AuditEvidence[] => [
  {
    filePath,
    line,
    message,
  },
];

const pass = (
  message: string,
  filePath?: string,
  line?: number
): AuditRuleResult => ({
  evidence: evidence(message, filePath, line),
  status: "pass",
});

const fail = (
  message: string,
  remediation: string,
  roast?: string
): AuditRuleResult => ({
  evidence: evidence(message),
  remediation,
  roast,
  status: "fail",
});

const findFirstSourceMatch = async (
  context: AuditContext,
  pattern: RegExp
): ReturnType<typeof findSourceMatch> =>
  findSourceMatch(context.project, pattern);

const hasAnyFile = async (
  rootDir: string,
  patterns: string[]
): Promise<string | null> => {
  const matches = await findFiles(rootDir, patterns, 4);

  return matches[0] ?? null;
};

const getAppRoutePatterns = (
  context: AuditContext,
  fileName: string
): string[] => {
  const appDir = context.project.paths.appDir;

  if (!appDir) {
    return [];
  }

  return [
    path.join(path.relative(context.project.rootDir, appDir), fileName),
    path.join(path.relative(context.project.rootDir, appDir), "**", fileName),
  ];
};

const shadcnConfigPresentRule: AuditRule = {
  adapters: ["core"],
  category: "foundation",
  confidence: "high",
  description: "Checks whether the app has a parseable shadcn components.json.",
  id: "shadcn-config-present",
  maxScore: 4,
  run: ({ project }) => {
    if (project.shadcn.configPath) {
      return pass(
        "components.json exists and parsed.",
        project.shadcn.configPath
      );
    }

    return fail(
      "components.json was not found or could not be parsed.",
      "Add or repair components.json so the CLI can resolve shadcn aliases and registry settings."
    );
  },
  severity: "warning",
  title: "shadcn config present",
};

const themeProviderConfiguredRule: AuditRule = {
  adapters: ["core"],
  category: "foundation",
  confidence: "high",
  description: "Checks for a mounted theme provider or theme class management.",
  id: "theme-provider-configured",
  maxScore: 5,
  run: async (context) => {
    const match = await findFirstSourceMatch(context, THEME_PROVIDER_PATTERN);

    if (match) {
      return pass(
        "Theme provider or next-themes usage found.",
        match.file.path,
        match.line
      );
    }

    return fail(
      "No theme provider or theme management was found.",
      "Mount a theme provider near the app shell and connect it to the dark-mode class.",
      "Dark mode without a provider is just vibes with a toggle."
    );
  },
  severity: "warning",
  title: "theme provider configured",
};

const themeHotkeyPresentRule: AuditRule = {
  adapters: ["core"],
  category: "interaction",
  confidence: "high",
  description:
    "Checks for a dark-mode keyboard shortcut that avoids typing targets.",
  id: "theme-hotkey-present",
  maxScore: 5,
  run: async (context) => {
    const hotkeyScopes = await findOwnedSourceScopes(
      context.project,
      KEYDOWN_HANDLER_PATTERN
    );
    const parsedFiles = await parseProjectSourceFiles(context.project);
    const filesByPath = new Map(
      parsedFiles.map((file) => [path.resolve(file.filePath), file])
    );
    const compilerOptions = getCompilerOptions(context.project);

    for (const scope of hotkeyScopes) {
      const hasKeyHandler = KEYDOWN_HANDLER_PATTERN.test(scope.content);
      const togglesTheme =
        DIRECT_THEME_TOGGLE_PATTERN.test(scope.content) ||
        sourceScopeCallsVerifiedThemeToggle(
          scope,
          context.project,
          compilerOptions,
          filesByPath
        );
      const checksDKey = D_KEY_PATTERN.test(scope.content);
      const ignoresTypingTargets = sourceScopeHasTypingTargetGuard(scope);

      if (hasKeyHandler && togglesTheme && checksDKey && ignoresTypingTargets) {
        return pass(
          "Dark-mode keyboard shortcut found and typing targets are guarded.",
          scope.file.filePath,
          getSourceScopeMatchLine(scope, D_KEY_PATTERN)
        );
      }
    }

    return fail(
      "No safe dark-mode keyboard shortcut was found.",
      "Add a `d` or Cmd+Shift+D shortcut that toggles theme and ignores inputs, textareas, selects, and contenteditable nodes.",
      "Pathetic. Pressing a button manually in 2026?"
    );
  },
  severity: "warning",
  title: "dark-mode shortcut present",
};

const metadataConfiguredRule: AuditRule = {
  adapters: ["core"],
  category: "foundation",
  confidence: "high",
  description: "Checks for framework-appropriate metadata or head basics.",
  id: "metadata-configured",
  maxScore: 3,
  run: async (context) => {
    if (context.project.framework.adapter === "next-app-router") {
      const match = await findFirstSourceMatch(context, NEXT_METADATA_PATTERN);

      if (match) {
        return pass("Next metadata export found.", match.file.path, match.line);
      }

      return fail(
        "No Next metadata export was found.",
        "Export `metadata` or `generateMetadata` from the root layout or relevant pages."
      );
    }

    const indexHtmlPath = path.join(context.project.rootDir, "index.html");

    if (await fileExists(indexHtmlPath)) {
      const document = await readProjectSourceFile(
        context.project,
        indexHtmlPath
      );
      const hasTitle = document
        ? HTML_TITLE_PATTERN.test(document.content)
        : false;
      const hasDescription = document
        ? HTML_DESCRIPTION_PATTERN.test(document.content)
        : false;

      if (hasTitle && hasDescription) {
        return pass(
          "Document title and description meta tag found.",
          indexHtmlPath,
          getTextLineNumber(document?.content ?? "", HTML_TITLE_PATTERN)
        );
      }
    }

    return fail(
      "No metadata/head basics were found.",
      "Add a document title and description metadata for the app shell."
    );
  },
  severity: "warning",
  title: "metadata configured",
};

const faviconPresentRule: AuditRule = {
  adapters: ["core"],
  category: "foundation",
  confidence: "high",
  description: "Checks for a favicon or app icon.",
  id: "favicon-present",
  maxScore: 2,
  run: async (context) => {
    const rootDir = context.project.rootDir;
    const filePath = await hasAnyFile(rootDir, [
      "app/favicon.ico",
      "app/icon.*",
      "src/app/favicon.ico",
      "src/app/icon.*",
      "public/favicon.ico",
      "public/icon.*",
    ]);

    if (filePath) {
      return pass("Favicon or app icon file found.", filePath);
    }

    const indexHtmlPath = path.join(rootDir, "index.html");

    if (await fileExists(indexHtmlPath)) {
      const document = await readProjectSourceFile(
        context.project,
        indexHtmlPath
      );

      if (document && FAVICON_LINK_PATTERN.test(document.content)) {
        return pass(
          "Favicon link found in index.html.",
          indexHtmlPath,
          getTextLineNumber(document.content, FAVICON_LINK_PATTERN)
        );
      }
    }

    return fail(
      "No favicon or app icon was found.",
      "Add `app/favicon.ico`, `app/icon.*`, `public/favicon.ico`, or an equivalent icon link."
    );
  },
  severity: "info",
  title: "favicon present",
};

const notFoundRoutePresentRule: AuditRule = {
  adapters: ["next-app-router"],
  category: "foundation",
  confidence: "high",
  description: "Checks for a Next App Router not-found boundary.",
  id: "not-found-route-present",
  maxScore: 3,
  run: async (context) => {
    const filePath = await hasAnyFile(
      context.project.rootDir,
      getAppRoutePatterns(context, "not-found.tsx")
    );

    if (filePath) {
      return pass("Next not-found route boundary found.", filePath);
    }

    return fail(
      "No Next `not-found.tsx` route boundary was found.",
      "Add `app/not-found.tsx` so missing routes have a designed state."
    );
  },
  severity: "warning",
  title: "not-found route present",
};

const errorBoundaryPresentRule: AuditRule = {
  adapters: ["core"],
  category: "foundation",
  confidence: "high",
  description: "Checks for an app-level error boundary.",
  id: "error-boundary-present",
  maxScore: 3,
  run: async (context) => {
    if (context.project.framework.adapter === "next-app-router") {
      const filePath = await hasAnyFile(
        context.project.rootDir,
        getAppRoutePatterns(context, "error.tsx")
      );

      if (filePath) {
        return pass("Next error route boundary found.", filePath);
      }
    }

    const match = await findFirstSourceMatch(context, ERROR_BOUNDARY_PATTERN);

    if (match) {
      return pass("Error boundary usage found.", match.file.path, match.line);
    }

    return fail(
      "No app-level error boundary was found.",
      "Add a route or component-level error boundary with a useful recovery path.",
      "The app can fail. The UI just refuses to acknowledge it."
    );
  },
  severity: "warning",
  title: "error boundary present",
};

const toastProviderPresentRule: AuditRule = {
  adapters: ["core"],
  category: "states",
  confidence: "high",
  description: "Checks for a mounted toast provider or toaster.",
  id: "toast-provider-present",
  maxScore: 3,
  run: async (context) => {
    const analysis = await analyzeToastRuntime(context.project);

    if (analysis.mount && analysis.runtime) {
      return pass(
        `Mounted ${analysis.mount.componentName} reaches the ${analysis.runtime.moduleName} toast runtime.`,
        analysis.mount.filePath,
        analysis.mount.line
      );
    }

    if (!analysis.hasDependency) {
      return fail(
        "No recognized toast runtime dependency was found.",
        "Install a toast runtime such as Sonner or Radix Toast, then mount its provider from the app shell."
      );
    }

    return fail(
      "No mounted toast provider with verifiable runtime provenance was found.",
      "Install and import a recognized toast runtime, then mount its toaster/provider so async feedback has somewhere to appear.",
      "Somewhere, a save button clicked successfully and nobody knew."
    );
  },
  severity: "warning",
  title: "toast setup present",
};

const highConfidenceRules = [
  shadcnConfigPresentRule,
  themeProviderConfiguredRule,
  themeHotkeyPresentRule,
  metadataConfiguredRule,
  faviconPresentRule,
  notFoundRoutePresentRule,
  errorBoundaryPresentRule,
  toastProviderPresentRule,
] satisfies AuditRule[];

export { highConfidenceRules };
