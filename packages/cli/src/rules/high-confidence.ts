import path from "node:path";
import { findOwnedSourceScopes } from "../ast";
import type {
  AuditContext,
  AuditEvidence,
  AuditRule,
  AuditRuleResult,
} from "../audit";
import {
  fileExists,
  findFiles,
  findSourceMatch,
  getTextLineNumber,
  readProjectSourceFile,
} from "./source-files";

const THEME_PROVIDER_PATTERN = /(<ThemeProvider\b|next-themes|useTheme\()/;
const KEYDOWN_HANDLER_PATTERN = /addEventListener\(["']keydown["']|onKeyDown/;
const THEME_TOGGLE_PATTERN = /(setTheme\(|classList\.toggle\(["']dark["'])/;
const D_KEY_PATTERN =
  /key\.toLowerCase\(\)\s*!==\s*["']d["']|key\s*===\s*["']d["']/;
const TYPING_TARGET_PATTERN = /(INPUT|TEXTAREA|SELECT|isContentEditable)/;
const NEXT_METADATA_PATTERN =
  /export\s+(const\s+metadata|async\s+function\s+generateMetadata|function\s+generateMetadata)/;
const HTML_TITLE_PATTERN = /<title>[^<]+<\/title>/;
const HTML_DESCRIPTION_PATTERN = /<meta\s+name=["']description["']/;
const FAVICON_LINK_PATTERN = /<link\s+rel=["'](?:icon|shortcut icon)["']/;
const ERROR_BOUNDARY_PATTERN =
  /(class\s+\w*ErrorBoundary|function\s+\w*ErrorBoundary|<ErrorBoundary\b|react-error-boundary)/;
const TOAST_IMPORT_PATTERN =
  /from\s+["'](?:sonner|react-hot-toast|@radix-ui\/react-toast)["']/;
const TOAST_MOUNT_PATTERN = /<(?:Toaster|ToastProvider|Sonner)(?:\s|>)/;
const TOAST_DEPENDENCIES = [
  "@radix-ui/react-toast",
  "react-hot-toast",
  "sonner",
] as const;

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

    for (const scope of hotkeyScopes) {
      const hasKeyHandler = KEYDOWN_HANDLER_PATTERN.test(scope.content);
      const togglesTheme = THEME_TOGGLE_PATTERN.test(scope.content);
      const checksDKey = D_KEY_PATTERN.test(scope.content);
      const ignoresTypingTargets = TYPING_TARGET_PATTERN.test(scope.content);

      if (hasKeyHandler && togglesTheme && checksDKey && ignoresTypingTargets) {
        return pass(
          "Dark-mode keyboard shortcut found and typing targets are guarded.",
          scope.file.filePath,
          scope.line
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
    const hasToastDependency = TOAST_DEPENDENCIES.some(
      (dependency) => context.project.dependencies[dependency]
    );
    const importMatch = await findFirstSourceMatch(
      context,
      TOAST_IMPORT_PATTERN
    );
    const mountMatch = await findFirstSourceMatch(context, TOAST_MOUNT_PATTERN);

    if (hasToastDependency && importMatch && mountMatch) {
      return pass(
        "Recognized toast runtime and mounted provider usage found.",
        mountMatch.file.path,
        mountMatch.line
      );
    }

    return fail(
      "No verifiable toast runtime and mounted provider were found.",
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
