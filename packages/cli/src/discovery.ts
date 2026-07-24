import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { type ParseError, parse } from "jsonc-parser";
import { glob } from "tinyglobby";

type JsonObject = Record<string, unknown>;

type FrameworkAdapter =
  | "laravel-inertia-react"
  | "next-app-router"
  | "next-hybrid-router"
  | "next-pages-router"
  | "tanstack-start"
  | "vite-react"
  | "generic-react";

type Confidence = "high" | "medium" | "low";
type PackageManager = "bun" | "npm" | "pnpm" | "unknown" | "yarn";
type ProjectDiscoveryErrorCode = "PROJECT_NOT_FOUND" | "UNSUPPORTED_PROJECT";
type SourceCoverage = "complete" | "partial";

interface DiscoverProjectOptions {
  filesystemRoot?: string;
}

interface FrameworkDiscovery {
  adapter: FrameworkAdapter;
  evidence: string[];
}

interface ShadcnDiscovery {
  aliases: Record<string, string>;
  confidence: Confidence;
  configPath: string | null;
  style: string | null;
}

interface ProjectPaths {
  appDir: string | null;
  bladeRootView: string | null;
  inertiaPagesDir: string | null;
  packageJson: string;
  pagesDir: string | null;
  routesDir: string | null;
  srcDir: string | null;
  tailwindCss: string | null;
  tsconfig: string | null;
  viteEntry: string | null;
}

interface ProjectVersions {
  inertia: string | null;
  laravel: string | null;
  next: string | null;
  react: string | null;
  tanstackStart: string | null;
  vite: string | null;
}

interface ProjectDiscovery {
  dependencies: Record<string, string>;
  framework: FrameworkDiscovery;
  packageManager: PackageManager;
  packageManagerRoot: string;
  packageName: string | null;
  paths: ProjectPaths;
  rootDir: string;
  scripts: Record<string, string>;
  selectedProjectPath: string;
  shadcn: ShadcnDiscovery;
  sourceCoverage: SourceCoverage;
  versions: ProjectVersions;
  warnings: string[];
}

class ProjectDiscoveryError extends Error {
  readonly code: ProjectDiscoveryErrorCode;

  constructor(
    message: string,
    code: ProjectDiscoveryErrorCode = "PROJECT_NOT_FOUND"
  ) {
    super(message);
    this.code = code;
    this.name = "ProjectDiscoveryError";
  }
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const isWithinRoot = (rootDir: string, candidatePath: string): boolean => {
  const relativePath = path.relative(rootDir, candidatePath);

  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

const readJson = async (filePath: string): Promise<JsonObject> => {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as JsonObject;
};

const readJsonc = async (
  filePath: string
): Promise<{ errors: ParseError[]; value: JsonObject | undefined }> => {
  const content = await readFile(filePath, "utf8");
  const errors: ParseError[] = [];
  const value = parse(content, errors, { allowTrailingComma: true }) as
    | JsonObject
    | undefined;

  return { errors, value };
};

const findProjectRoot = async (
  cwd: string,
  filesystemRoot?: string
): Promise<string> => {
  let currentDir = path.resolve(cwd);
  const resolvedFilesystemRoot = filesystemRoot
    ? path.resolve(filesystemRoot)
    : null;

  if (
    resolvedFilesystemRoot &&
    !isWithinRoot(resolvedFilesystemRoot, currentDir)
  ) {
    throw new ProjectDiscoveryError(
      "The requested project is outside the scan boundary."
    );
  }

  while (true) {
    if (await fileExists(path.join(currentDir, "package.json"))) {
      return currentDir;
    }

    if (currentDir === resolvedFilesystemRoot) {
      throw new ProjectDiscoveryError(
        "No package.json was found inside the scan boundary."
      );
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new ProjectDiscoveryError(
        "No package.json was found in this directory or its parents."
      );
    }

    currentDir = parentDir;
  }
};

const getDependencies = (packageJson: JsonObject): Record<string, string> => {
  const dependencyGroups = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies,
  ];
  const dependencies: Record<string, string> = {};

  for (const dependencyGroup of dependencyGroups) {
    if (
      !dependencyGroup ||
      typeof dependencyGroup !== "object" ||
      Array.isArray(dependencyGroup)
    ) {
      continue;
    }

    for (const [name, version] of Object.entries(dependencyGroup)) {
      if (typeof version === "string") {
        dependencies[name] = version;
      }
    }
  }

  return dependencies;
};

const PACKAGE_MANAGER_FIELD_PATTERN = /^(bun|npm|pnpm|yarn)@/;
const PACKAGE_MANAGER_LOCKFILES = [
  ["pnpm", "pnpm-lock.yaml"],
  ["yarn", "yarn.lock"],
  ["npm", "package-lock.json"],
  ["bun", "bun.lock"],
  ["bun", "bun.lockb"],
] as const satisfies readonly (readonly [PackageManager, string])[];

const getDeclaredPackageManager = async (
  packageJsonPath: string
): Promise<PackageManager | null> => {
  if (!(await fileExists(packageJsonPath))) {
    return null;
  }

  try {
    const packageJson = await readJson(packageJsonPath);
    const declaredPackageManager = packageJson.packageManager;

    if (typeof declaredPackageManager !== "string") {
      return null;
    }

    return (PACKAGE_MANAGER_FIELD_PATTERN.exec(declaredPackageManager)?.[1] ??
      null) as PackageManager | null;
  } catch {
    return null;
  }
};

const detectPackageManager = async (
  rootDir: string,
  filesystemRoot?: string
): Promise<{ packageManager: PackageManager; rootDir: string }> => {
  const resolvedProjectRoot = path.resolve(rootDir);
  const resolvedFilesystemRoot = filesystemRoot
    ? path.resolve(filesystemRoot)
    : null;
  let currentDir = resolvedProjectRoot;

  while (true) {
    const declaredPackageManager = await getDeclaredPackageManager(
      path.join(currentDir, "package.json")
    );
    if (declaredPackageManager) {
      return { packageManager: declaredPackageManager, rootDir: currentDir };
    }

    for (const [packageManager, lockfile] of PACKAGE_MANAGER_LOCKFILES) {
      if (await fileExists(path.join(currentDir, lockfile))) {
        return { packageManager, rootDir: currentDir };
      }
    }

    const reachedBoundary =
      currentDir === resolvedFilesystemRoot ||
      (await fileExists(path.join(currentDir, ".git")));
    if (reachedBoundary) {
      return { packageManager: "unknown", rootDir: currentDir };
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return { packageManager: "unknown", rootDir: resolvedProjectRoot };
};

const getStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record: Record<string, string> = {};

  for (const [key, childValue] of Object.entries(value)) {
    if (typeof childValue === "string") {
      record[key] = childValue;
    }
  }

  return record;
};

const detectAppDir = async (rootDir: string): Promise<string | null> => {
  const appDirs = [path.join(rootDir, "app"), path.join(rootDir, "src", "app")];

  for (const appDir of appDirs) {
    if (await fileExists(appDir)) {
      return appDir;
    }
  }

  return null;
};

const detectPagesDir = async (rootDir: string): Promise<string | null> => {
  const pagesDirs = [
    path.join(rootDir, "pages"),
    path.join(rootDir, "src", "pages"),
  ];

  for (const pagesDir of pagesDirs) {
    if (await fileExists(pagesDir)) {
      return pagesDir;
    }
  }

  return null;
};

const detectInertiaPagesDir = async (
  rootDir: string
): Promise<string | null> => {
  // The Laravel React starter kit uses resources/js/pages; years of Inertia
  // documentation used the capitalized form, and both are common.
  const pagesDirs = [
    path.join(rootDir, "resources", "js", "pages"),
    path.join(rootDir, "resources", "js", "Pages"),
  ];

  for (const pagesDir of pagesDirs) {
    if (await fileExists(pagesDir)) {
      return pagesDir;
    }
  }

  return null;
};

const detectBladeRootView = async (rootDir: string): Promise<string | null> => {
  const bladeRootView = path.join(
    rootDir,
    "resources",
    "views",
    "app.blade.php"
  );

  return (await fileExists(bladeRootView)) ? bladeRootView : null;
};

const getLaravelFrameworkVersion = async (
  rootDir: string
): Promise<string | null> => {
  const composerJsonPath = path.join(rootDir, "composer.json");

  if (!(await fileExists(composerJsonPath))) {
    return null;
  }

  try {
    const composerJson = await readJson(composerJsonPath);
    const requirements = composerJson.require;

    if (
      !requirements ||
      typeof requirements !== "object" ||
      Array.isArray(requirements)
    ) {
      return null;
    }

    const laravelVersion = (requirements as JsonObject)["laravel/framework"];
    return typeof laravelVersion === "string" ? laravelVersion : null;
  } catch {
    return null;
  }
};

const detectRoutesDir = async (rootDir: string): Promise<string | null> => {
  const routesDirs = [
    path.join(rootDir, "src", "routes"),
    path.join(rootDir, "app", "routes"),
  ];

  for (const routesDir of routesDirs) {
    if (await fileExists(routesDir)) {
      return routesDir;
    }
  }

  return null;
};

const detectViteEntry = async (rootDir: string): Promise<string | null> => {
  const entryCandidates = [
    path.join(rootDir, "src", "main.tsx"),
    path.join(rootDir, "src", "main.jsx"),
    path.join(rootDir, "src", "App.tsx"),
    path.join(rootDir, "src", "App.jsx"),
  ];

  for (const entryCandidate of entryCandidates) {
    if (await fileExists(entryCandidate)) {
      return entryCandidate;
    }
  }

  return null;
};

const detectTailwindCss = async (
  rootDir: string,
  shadcnConfig: JsonObject | undefined
): Promise<string | null> => {
  const tailwind = shadcnConfig?.tailwind;

  if (tailwind && typeof tailwind === "object" && !Array.isArray(tailwind)) {
    const cssPath = (tailwind as JsonObject).css;

    if (typeof cssPath === "string") {
      return path.join(rootDir, cssPath);
    }
  }

  const matches = await glob(["app/globals.css", "src/**/*.css"], {
    absolute: true,
    cwd: rootDir,
    deep: 3,
  });

  return matches[0] ?? null;
};

interface DetectFrameworkOptions {
  appDir: string | null;
  dependencies: Record<string, string>;
  hasArtisan: boolean;
  inertiaPagesDir: string | null;
  pagesDir: string | null;
  rootDir: string;
  routesDir: string | null;
  viteEntry: string | null;
}

const detectNextFramework = ({
  appDir,
  dependencies,
  pagesDir,
  rootDir,
}: DetectFrameworkOptions): FrameworkDiscovery | null => {
  if (!(dependencies.next && (appDir || pagesDir))) {
    return null;
  }

  const evidence = ["next dependency found"];

  if (appDir) {
    evidence.push(
      `app router directory found at ${path.relative(rootDir, appDir)}`
    );
  }

  if (pagesDir) {
    evidence.push(
      `pages router directory found at ${path.relative(rootDir, pagesDir)}`
    );
  }

  if (appDir && pagesDir) {
    return { adapter: "next-hybrid-router", evidence };
  }

  return {
    adapter: appDir ? "next-app-router" : "next-pages-router",
    evidence,
  };
};

const detectLaravelInertiaFramework = (
  {
    dependencies,
    hasArtisan,
    inertiaPagesDir,
    rootDir,
  }: DetectFrameworkOptions,
  fallthroughEvidence: string[]
): FrameworkDiscovery | null => {
  if (!dependencies["@inertiajs/react"]) {
    return null;
  }

  const hasLaravelMarker =
    hasArtisan || Boolean(dependencies["laravel-vite-plugin"]);

  if (inertiaPagesDir && hasLaravelMarker) {
    return {
      adapter: "laravel-inertia-react",
      evidence: [
        "inertia react dependency found",
        hasArtisan
          ? "laravel artisan file found"
          : "laravel-vite-plugin dependency found",
        `inertia pages directory found at ${path.relative(rootDir, inertiaPagesDir)}`,
      ],
    };
  }

  fallthroughEvidence.push(
    hasLaravelMarker
      ? "inertia react dependency found but no resources/js/pages directory exists"
      : "inertia react dependency found without a laravel marker (artisan or laravel-vite-plugin); non-laravel inertia hosts use the vite or generic adapter"
  );
  return null;
};

const detectTanstackStartFramework = (
  { dependencies, rootDir, routesDir }: DetectFrameworkOptions,
  fallthroughEvidence: string[]
): FrameworkDiscovery | null => {
  if (dependencies["@tanstack/react-start"] && routesDir) {
    return {
      adapter: "tanstack-start",
      evidence: [
        "tanstack start dependency found",
        `route files directory found at ${path.relative(rootDir, routesDir)}`,
      ],
    };
  }

  if (dependencies["@tanstack/react-start"]) {
    fallthroughEvidence.push(
      "tanstack start dependency found but no routes directory (src/routes or app/routes) exists"
    );
  } else if (dependencies["@tanstack/react-router"]) {
    fallthroughEvidence.push(
      "tanstack router dependency found; router-only projects use the vite or generic adapter"
    );
  }

  return null;
};

const detectFramework = (
  options: DetectFrameworkOptions
): FrameworkDiscovery => {
  const { dependencies, rootDir, viteEntry } = options;
  const evidence: string[] = [];

  const framework =
    detectNextFramework(options) ??
    detectLaravelInertiaFramework(options, evidence) ??
    detectTanstackStartFramework(options, evidence);

  if (framework) {
    return framework;
  }

  if (dependencies.vite && dependencies.react && viteEntry) {
    evidence.push("vite and react dependencies found");
    evidence.push(`vite entry found at ${path.relative(rootDir, viteEntry)}`);

    return {
      adapter: "vite-react",
      evidence,
    };
  }

  if (dependencies.react) {
    evidence.push("react dependency found");
  } else {
    evidence.push("no framework-specific adapter matched");
  }

  return {
    adapter: "generic-react",
    evidence,
  };
};

const discoverProject = async (
  cwd: string,
  options: DiscoverProjectOptions = {}
): Promise<ProjectDiscovery> => {
  const rootDir = await findProjectRoot(cwd, options.filesystemRoot);
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = await readJson(packageJsonPath);
  const dependencies = getDependencies(packageJson);

  if (!dependencies.react) {
    const laravelVersion = await getLaravelFrameworkVersion(rootDir);

    throw new ProjectDiscoveryError(
      laravelVersion
        ? "This Laravel application has no React dependency, so its UI stack is Blade or Livewire. Shadscan audits React shadcn UIs; on Laravel that means Inertia with React."
        : "The nearest package does not declare React; run shadscan from a React application package.",
      "UNSUPPORTED_PROJECT"
    );
  }

  const warnings: string[] = [];
  const componentsJsonPath = path.join(rootDir, "components.json");
  let shadcnConfig: JsonObject | undefined;
  let shadcnConfidence: Confidence = "low";

  if (await fileExists(componentsJsonPath)) {
    const { errors, value } = await readJsonc(componentsJsonPath);

    if (errors.length > 0 || !value) {
      warnings.push("components.json exists but could not be parsed.");
    } else {
      shadcnConfig = value;
      shadcnConfidence = "high";
    }
  } else {
    warnings.push(
      "components.json was not found; shadcn detection confidence is low."
    );
  }

  const appDir = await detectAppDir(rootDir);
  const bladeRootView = await detectBladeRootView(rootDir);
  const hasArtisan = await fileExists(path.join(rootDir, "artisan"));
  const inertiaPagesDir = await detectInertiaPagesDir(rootDir);
  const laravelVersion = await getLaravelFrameworkVersion(rootDir);
  const pagesDir = await detectPagesDir(rootDir);
  const routesDir = await detectRoutesDir(rootDir);
  const viteEntry = await detectViteEntry(rootDir);
  const framework = detectFramework({
    appDir,
    dependencies,
    hasArtisan,
    inertiaPagesDir,
    pagesDir,
    rootDir,
    routesDir,
    viteEntry,
  });
  const tailwindCss = await detectTailwindCss(rootDir, shadcnConfig);
  const tsconfig = path.join(rootDir, "tsconfig.json");
  const srcDir = path.join(rootDir, "src");
  const packageName =
    typeof packageJson.name === "string" ? packageJson.name : null;
  const packageManagerDiscovery = await detectPackageManager(
    rootDir,
    options.filesystemRoot
  );
  const selectedProjectPath =
    path
      .relative(packageManagerDiscovery.rootDir, rootDir)
      .split(path.sep)
      .join("/") || ".";

  return {
    dependencies,
    framework,
    packageManager: packageManagerDiscovery.packageManager,
    packageManagerRoot: packageManagerDiscovery.rootDir,
    packageName,
    paths: {
      appDir,
      bladeRootView,
      inertiaPagesDir,
      packageJson: packageJsonPath,
      pagesDir,
      routesDir,
      srcDir: (await fileExists(srcDir)) ? srcDir : null,
      tailwindCss,
      tsconfig: (await fileExists(tsconfig)) ? tsconfig : null,
      viteEntry,
    },
    rootDir,
    selectedProjectPath,
    scripts: getStringRecord(packageJson.scripts),
    shadcn: {
      aliases: getStringRecord(shadcnConfig?.aliases),
      configPath: shadcnConfig ? componentsJsonPath : null,
      confidence: shadcnConfidence,
      style:
        typeof shadcnConfig?.style === "string" ? shadcnConfig.style : null,
    },
    sourceCoverage: "complete",
    versions: {
      inertia: dependencies["@inertiajs/react"] ?? null,
      laravel: laravelVersion,
      next: dependencies.next ?? null,
      react: dependencies.react ?? null,
      tanstackStart: dependencies["@tanstack/react-start"] ?? null,
      vite: dependencies.vite ?? null,
    },
    warnings,
  };
};

export type {
  Confidence,
  DiscoverProjectOptions,
  FrameworkAdapter,
  ProjectDiscovery,
  ProjectDiscoveryErrorCode,
  SourceCoverage,
};
export { discoverProject, ProjectDiscoveryError };
