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
  resolveModuleName,
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
  type ConfinedTypeScriptHost,
  createConfinedTypeScriptHost,
} from "../typescript-host";
import { findAstroDocumentShells, getAstroSourceFiles } from "./astro-mounts";
import { findDeclarativeHotkeyScopes } from "./declarative-hotkeys";
import {
  ERROR_BOUNDARY_EXPORT_PATTERN,
  getReactRouterAppFiles,
  isReactRouterFramework,
  META_EXPORT_PATTERN,
  ROUTE_ERROR_RESPONSE_PATTERN,
} from "./react-router-modules";
import {
  fileExists,
  findFiles,
  findSourceMatch,
  getAppRelativePatterns,
  getProjectSourceFiles,
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
  /(?:\bkey\s*(?:\.\s*to(?:Locale)?LowerCase\(\))?\s*(?:===|!==)\s*["']d["']|["']d["']\s*(?:===|!==)\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*\bkey\s*(?:\.\s*to(?:Locale)?LowerCase\(\))?|\bcode\s*(?:===|!==)\s*["']KeyD["']|["']KeyD["']\s*(?:===|!==)\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*\bcode)/;
const NEXT_METADATA_PATTERN =
  /export\s+(const\s+metadata|async\s+function\s+generateMetadata|function\s+generateMetadata)/;
const HTML_TITLE_PATTERN = /<title>\s*[^<\s][^<]*<\/title>/i;
const HTML_DESCRIPTION_PATTERN =
  /<meta(?=[^>]*name=["']description["'])(?=[^>]*content=["'][^"']+["'])[^>]*>/i;
const FAVICON_LINK_PATTERN = /<link\s+rel=["'](?:icon|shortcut icon)["']/;
const TANSTACK_HEAD_OPTION_PATTERN = /\bhead\s*:\s*(?:\(|[\w$]+\s*=>)/;
const TANSTACK_HEAD_TITLE_PATTERN = /\btitle\s*:\s*["'`][^"'`]+["'`]/;
const TANSTACK_FAVICON_LINK_PATTERN =
  /\brel\s*:\s*["'](?:icon|shortcut icon)["']/;
const TANSTACK_NOT_FOUND_PATTERN =
  /\b(?:defaultNotFoundComponent|notFoundComponent)\s*:/;
const INERTIA_HEAD_TITLE_ATTRIBUTE_PATTERN = /<Head\b[^>]*\btitle\s*=/;
const INERTIA_HEAD_TITLE_CHILD_PATTERN = /<Head\b[\s\S]{0,600}?<title[\s>]/;
const BLADE_INERTIA_TITLE_PATTERN = /<title\b[^>]*\binertia\b/;
const ERROR_BOUNDARY_PATTERN =
  /(class\s+\w*ErrorBoundary|function\s+\w*ErrorBoundary|<ErrorBoundary\b|react-error-boundary)/;
interface ImportedHelper {
  importedName: string;
  moduleName: string;
}

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
  host: ConfinedTypeScriptHost,
  filesByPath: Map<string, ParsedSourceFile>
): ParsedSourceFile | null => {
  const resolvedFileName = resolveModuleName(
    moduleName,
    containingFile.filePath,
    compilerOptions,
    host
  ).resolvedModule?.resolvedFileName;

  if (
    !(
      resolvedFileName &&
      host.isPathAllowed(resolvedFileName) &&
      isWithinProject(project.rootDir, resolvedFileName)
    )
  ) {
    return null;
  }

  return filesByPath.get(path.resolve(resolvedFileName)) ?? null;
};

const sourceScopeCallsVerifiedThemeToggle = (
  scope: SourceScope,
  project: ProjectDiscovery,
  compilerOptions: CompilerOptions,
  host: ConfinedTypeScriptHost,
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
      host,
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

const findSourceMatchInDirectory = async (
  context: AuditContext,
  directory: string,
  patterns: RegExp[]
): Promise<{ filePath: string; line: number } | null> => {
  const resolvedDirectory = path.resolve(directory);
  const files = await getProjectSourceFiles(context.project);

  for (const file of files) {
    const relativePath = path.relative(resolvedDirectory, file.path);
    const isInsideDirectory =
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath);

    if (
      isInsideDirectory &&
      patterns.every((pattern) => pattern.test(file.content))
    ) {
      return {
        filePath: file.path,
        line: getTextLineNumber(file.content, patterns[0]) ?? 1,
      };
    }
  }

  return null;
};

const evaluateHtmlMetadataConfiguration = async (
  context: AuditContext
): Promise<AuditRuleResult> => {
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
    const host = createConfinedTypeScriptHost(context.filesystemRoot);
    const compilerOptions = getCompilerOptions(context.project, host);
    const togglesTheme = (scope: SourceScope): boolean =>
      DIRECT_THEME_TOGGLE_PATTERN.test(scope.content) ||
      sourceScopeCallsVerifiedThemeToggle(
        scope,
        context.project,
        compilerOptions,
        host,
        filesByPath
      );

    for (const scope of hotkeyScopes) {
      const hasKeyHandler = KEYDOWN_HANDLER_PATTERN.test(scope.content);
      const checksDKey = D_KEY_PATTERN.test(scope.content);
      const ignoresTypingTargets = sourceScopeHasTypingTargetGuard(scope);

      if (
        hasKeyHandler &&
        togglesTheme(scope) &&
        checksDKey &&
        ignoresTypingTargets
      ) {
        return pass(
          "Dark-mode keyboard shortcut found and typing targets are guarded.",
          scope.file.filePath,
          getSourceScopeMatchLine(scope, D_KEY_PATTERN)
        );
      }
    }

    // A declarative registration never contains a keydown listener of its
    // own, so it is discovered separately. The library's own option
    // semantics stand in for the manual typing-target guard.
    for (const file of parsedFiles) {
      for (const { hotkey, scope } of findDeclarativeHotkeyScopes(file)) {
        if (
          hotkey.targetsDKey &&
          hotkey.guardsTypingTargets &&
          togglesTheme(scope)
        ) {
          return pass(
            "Dark-mode keyboard shortcut registered through a hotkey library that ignores typing targets.",
            file.filePath,
            hotkey.line
          );
        }
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

const evaluateTanstackDocumentTitle = async (
  context: AuditContext,
  routesDir: string
): Promise<AuditRuleResult> => {
  const match = await findSourceMatchInDirectory(context, routesDir, [
    TANSTACK_HEAD_OPTION_PATTERN,
    TANSTACK_HEAD_TITLE_PATTERN,
  ]);

  if (!match) {
    return fail(
      "No TanStack Start head() metadata with a title was found.",
      "Return `meta` entries with a title and description from the root route's `head()` option."
    );
  }

  return pass(
    "TanStack Start head() metadata found.",
    match.filePath,
    match.line
  );
};

const evaluateReactRouterMeta = async (
  context: AuditContext
): Promise<AuditRuleResult> => {
  const modules = await getReactRouterAppFiles(context.project);
  const withMeta = modules.find((file) =>
    META_EXPORT_PATTERN.test(file.content)
  );

  if (!withMeta) {
    return fail(
      "No React Router `meta` export was found.",
      "Export `meta` from the root or a route module returning a title and description."
    );
  }

  return pass(
    "React Router meta export found.",
    withMeta.path,
    getTextLineNumber(withMeta.content, META_EXPORT_PATTERN)
  );
};

const evaluateTanstackNotFound = async (
  context: AuditContext
): Promise<AuditRuleResult> => {
  const notFoundMatch = await findSourceMatch(
    context.project,
    TANSTACK_NOT_FOUND_PATTERN
  );

  if (!notFoundMatch) {
    return fail(
      "No TanStack Start not-found component was found.",
      "Add `notFoundComponent` to the root route or `defaultNotFoundComponent` to `createRouter` so missing routes have a designed state."
    );
  }

  return pass(
    "TanStack Start not-found component found.",
    notFoundMatch.file.path,
    notFoundMatch.line
  );
};

const evaluateReactRouterNotFound = async (
  context: AuditContext
): Promise<AuditRuleResult> => {
  const appDir = context.project.paths.reactRouterAppDir;
  const splatRoute = appDir
    ? await hasAnyFile(context.project.rootDir, [
        "app/routes/$.{js,jsx,ts,tsx}",
        "app/routes/**/$.{js,jsx,ts,tsx}",
      ])
    : null;

  if (splatRoute) {
    return pass("React Router splat route found.", splatRoute);
  }

  const modules = await getReactRouterAppFiles(context.project);
  const boundary = modules.find(
    (file) =>
      ERROR_BOUNDARY_EXPORT_PATTERN.test(file.content) &&
      ROUTE_ERROR_RESPONSE_PATTERN.test(file.content)
  );

  if (boundary) {
    return pass(
      "React Router ErrorBoundary handles route error responses.",
      boundary.path,
      getTextLineNumber(boundary.content, ERROR_BOUNDARY_EXPORT_PATTERN)
    );
  }

  return fail(
    "No React Router not-found handling was found.",
    "Handle `isRouteErrorResponse` in an `ErrorBoundary` export, or add a splat route at `app/routes/$.tsx`."
  );
};

const evaluateAstroDocumentTitle = async (
  context: AuditContext
): Promise<AuditRuleResult> => {
  const astroFiles = await getAstroSourceFiles(context.project);
  const titled = astroFiles.find((file) =>
    HTML_TITLE_PATTERN.test(file.content)
  );

  if (!titled) {
    return fail(
      "No Astro page or layout provides a document title.",
      "Add a non-empty title element to the layout's head, or per page."
    );
  }

  return pass(
    "Astro document title found.",
    titled.path,
    getTextLineNumber(titled.content, HTML_TITLE_PATTERN)
  );
};

const evaluateInertiaDocumentTitle = async (
  context: AuditContext
): Promise<AuditRuleResult> => {
  const attributeMatch = await findSourceMatch(
    context.project,
    INERTIA_HEAD_TITLE_ATTRIBUTE_PATTERN
  );
  const childMatch =
    attributeMatch ??
    (await findSourceMatch(context.project, INERTIA_HEAD_TITLE_CHILD_PATTERN));

  if (childMatch) {
    return pass(
      "Inertia Head metadata with a title found.",
      childMatch.file.path,
      childMatch.line
    );
  }

  const bladeRootView = context.project.paths.bladeRootView;
  const bladeDocument = bladeRootView
    ? await readProjectSourceFile(context.project, bladeRootView)
    : null;

  if (
    bladeDocument &&
    (BLADE_INERTIA_TITLE_PATTERN.test(bladeDocument.content) ||
      HTML_TITLE_PATTERN.test(bladeDocument.content))
  ) {
    return pass(
      "Blade root view provides the document title.",
      bladeDocument.path,
      getTextLineNumber(bladeDocument.content, HTML_TITLE_PATTERN) ??
        getTextLineNumber(bladeDocument.content, BLADE_INERTIA_TITLE_PATTERN)
    );
  }

  return fail(
    "No Inertia Head title or Blade root view title was found.",
    'Render Inertia\'s `<Head title="…">` in your pages or add a title element to `resources/views/app.blade.php`.'
  );
};

const metadataConfiguredRule: AuditRule = {
  adapters: ["core"],
  category: "foundation",
  confidence: "high",
  description: "Checks for framework-appropriate metadata or head basics.",
  id: "metadata-configured",
  maxScore: 3,
  run: async (context) => {
    const { appDir, pagesDir, routesDir } = context.project.paths;
    let firstMatch: { filePath: string; line: number } | null = null;

    if (isReactRouterFramework(context.project)) {
      return evaluateReactRouterMeta(context);
    }

    if (context.project.versions.astro && context.project.paths.astroPagesDir) {
      return evaluateAstroDocumentTitle(context);
    }

    if (
      context.project.versions.inertia &&
      context.project.paths.inertiaPagesDir
    ) {
      return evaluateInertiaDocumentTitle(context);
    }

    if (context.project.versions.tanstackStart && routesDir) {
      return evaluateTanstackDocumentTitle(context, routesDir);
    }

    if (context.project.versions.next && appDir) {
      const match = await findSourceMatchInDirectory(context, appDir, [
        NEXT_METADATA_PATTERN,
      ]);

      if (!match) {
        return fail(
          "No Next App Router metadata export was found.",
          "Export `metadata` or `generateMetadata` from the root layout or relevant pages."
        );
      }

      firstMatch = match;
    }

    if (context.project.versions.next && pagesDir) {
      const match = await findSourceMatchInDirectory(context, pagesDir, [
        HTML_TITLE_PATTERN,
        HTML_DESCRIPTION_PATTERN,
      ]);

      if (!match) {
        return fail(
          "No complete Next Pages Router head metadata was found.",
          "Add a meaningful title and description through `next/head` in the Pages Router."
        );
      }

      firstMatch ??= match;
    }

    if (firstMatch) {
      return pass(
        appDir && pagesDir
          ? "Both Next router trees configure document metadata."
          : "Next metadata or head configuration found.",
        firstMatch.filePath,
        firstMatch.line
      );
    }

    return evaluateHtmlMetadataConfiguration(context);
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
      "public/favicon.*",
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

    const routesDir = context.project.paths.routesDir;

    if (context.project.versions.tanstackStart && routesDir) {
      const linkMatch = await findSourceMatchInDirectory(context, routesDir, [
        TANSTACK_FAVICON_LINK_PATTERN,
      ]);

      if (linkMatch) {
        return pass(
          "Favicon link found in a TanStack Start head() links entry.",
          linkMatch.filePath,
          linkMatch.line
        );
      }
    }

    const bladeRootView = context.project.paths.bladeRootView;

    if (bladeRootView) {
      const bladeDocument = await readProjectSourceFile(
        context.project,
        bladeRootView
      );

      if (bladeDocument && FAVICON_LINK_PATTERN.test(bladeDocument.content)) {
        return pass(
          "Favicon link found in the Blade root view.",
          bladeRootView,
          getTextLineNumber(bladeDocument.content, FAVICON_LINK_PATTERN)
        );
      }
    }

    if (context.project.versions.astro && context.project.paths.astroPagesDir) {
      const shells = await findAstroDocumentShells(context.project);
      const linked = shells.find((shell) =>
        FAVICON_LINK_PATTERN.test(shell.content)
      );

      if (linked) {
        return pass(
          "Favicon link found in the Astro document shell.",
          linked.path,
          getTextLineNumber(linked.content, FAVICON_LINK_PATTERN)
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

const evaluateAstroNotFoundPage = async (
  context: AuditContext
): Promise<AuditRuleResult> => {
  const astroNotFound = await hasAnyFile(context.project.rootDir, [
    "src/pages/404.{astro,md,mdx}",
  ]);

  if (!astroNotFound) {
    return fail(
      "No Astro 404 page was found.",
      "Add `src/pages/404.astro` so missing routes have a designed state."
    );
  }

  return pass("Astro 404 page found.", astroNotFound);
};

const notFoundRoutePresentRule: AuditRule = {
  adapters: [
    "astro-react",
    "laravel-inertia-react",
    "next-app-router",
    "next-hybrid-router",
    "next-pages-router",
    "react-router-framework",
    "tanstack-start",
  ],
  category: "foundation",
  confidence: "high",
  description:
    "Checks for a framework-appropriate not-found surface: a Next boundary or 404 page, a TanStack Start not-found component, a Laravel error page, an Astro 404 page, or React Router route-error handling.",
  id: "not-found-route-present",
  maxScore: 3,
  run: async (context) => {
    const foundPaths: string[] = [];

    if (isReactRouterFramework(context.project)) {
      return evaluateReactRouterNotFound(context);
    }

    if (context.project.versions.astro && context.project.paths.astroPagesDir) {
      return evaluateAstroNotFoundPage(context);
    }

    if (context.project.versions.inertia && context.project.versions.laravel) {
      const errorSurface = await hasAnyFile(context.project.rootDir, [
        "resources/views/errors/404.blade.php",
        "resources/js/pages/{error,Error}*.{jsx,tsx}",
        "resources/js/Pages/{error,Error}*.{jsx,tsx}",
      ]);

      if (!errorSurface) {
        return fail(
          "No Laravel 404 error view or Inertia error page was found.",
          "Add `resources/views/errors/404.blade.php` or render an Inertia error page component so missing routes have a designed state."
        );
      }

      return pass("Laravel not-found error surface found.", errorSurface);
    }

    if (context.project.versions.tanstackStart) {
      return evaluateTanstackNotFound(context);
    }

    if (context.project.versions.next && context.project.paths.appDir) {
      const appNotFound = await hasAnyFile(
        context.project.rootDir,
        getAppRelativePatterns(context, "not-found.{js,jsx,ts,tsx}")
      );

      if (!appNotFound) {
        return fail(
          "No Next `not-found.tsx` route boundary was found.",
          "Add `app/not-found.tsx` so App Router missing routes have a designed state."
        );
      }

      foundPaths.push(appNotFound);
    }

    if (context.project.versions.next && context.project.paths.pagesDir) {
      const pagesNotFound = await hasAnyFile(context.project.rootDir, [
        "pages/404.{js,jsx,ts,tsx}",
        "src/pages/404.{js,jsx,ts,tsx}",
      ]);

      if (!pagesNotFound) {
        return fail(
          "No Next Pages Router `404` page was found.",
          "Add `pages/404.tsx` so Pages Router missing routes have a designed state."
        );
      }

      foundPaths.push(pagesNotFound);
    }

    if (foundPaths[0]) {
      return pass(
        foundPaths.length > 1
          ? "Both Next router trees provide not-found UI."
          : "Next not-found route boundary found.",
        foundPaths[0]
      );
    }

    return fail(
      "No supported Next route directory was found.",
      "Add a Next App Router or Pages Router route tree before configuring not-found UI."
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
    const foundPaths: string[] = [];
    const missingBoundaries: string[] = [];

    if (isReactRouterFramework(context.project)) {
      const modules = await getReactRouterAppFiles(context.project);
      const boundary = modules.find((file) =>
        ERROR_BOUNDARY_EXPORT_PATTERN.test(file.content)
      );

      if (boundary) {
        return pass(
          "React Router ErrorBoundary export found.",
          boundary.path,
          getTextLineNumber(boundary.content, ERROR_BOUNDARY_EXPORT_PATTERN)
        );
      }

      return fail(
        "No React Router `ErrorBoundary` export was found.",
        "Export an `ErrorBoundary` from `app/root.tsx` so render and loader errors have a designed state."
      );
    }

    if (context.project.versions.next && context.project.paths.appDir) {
      const appError = await hasAnyFile(
        context.project.rootDir,
        getAppRelativePatterns(context, "error.{js,jsx,ts,tsx}")
      );

      if (appError) {
        foundPaths.push(appError);
      } else {
        missingBoundaries.push("App Router `error.tsx`");
      }
    }

    if (context.project.versions.next && context.project.paths.pagesDir) {
      const pagesError = await hasAnyFile(context.project.rootDir, [
        "pages/_error.{js,jsx,ts,tsx}",
        "src/pages/_error.{js,jsx,ts,tsx}",
      ]);

      if (pagesError) {
        foundPaths.push(pagesError);
      } else {
        missingBoundaries.push("Pages Router `_error` page");
      }
    }

    if (foundPaths.length > 0 && missingBoundaries.length === 0) {
      return pass(
        foundPaths.length > 1
          ? "Both Next router trees provide error boundaries."
          : "Next error route boundary found.",
        foundPaths[0]
      );
    }

    const match = await findFirstSourceMatch(context, ERROR_BOUNDARY_PATTERN);

    if (match) {
      return pass("Error boundary usage found.", match.file.path, match.line);
    }

    return fail(
      missingBoundaries.length > 0
        ? `Missing ${missingBoundaries.join(" and ")}.`
        : "No app-level error boundary was found.",
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
    const analysis = await analyzeToastRuntime(
      context.project,
      context.filesystemRoot
    );

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
        "Install a toast runtime such as Base UI Toast, Sonner, or Radix Toast, then mount its provider from the app shell."
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
