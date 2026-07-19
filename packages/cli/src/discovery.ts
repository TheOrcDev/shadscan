import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { type ParseError, parse } from "jsonc-parser";
import { glob } from "tinyglobby";

type JsonObject = Record<string, unknown>;

type FrameworkAdapter = "next-app-router" | "vite-react" | "generic-react";

type Confidence = "high" | "medium" | "low";
type ProjectDiscoveryErrorCode = "PROJECT_NOT_FOUND" | "UNSUPPORTED_PROJECT";

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
  packageJson: string;
  srcDir: string | null;
  tailwindCss: string | null;
  tsconfig: string | null;
  viteEntry: string | null;
}

interface ProjectVersions {
  next: string | null;
  react: string | null;
  vite: string | null;
}

interface ProjectDiscovery {
  dependencies: Record<string, string>;
  framework: FrameworkDiscovery;
  packageManager: "bun" | "npm" | "pnpm" | "unknown" | "yarn";
  packageName: string | null;
  paths: ProjectPaths;
  rootDir: string;
  scripts: Record<string, string>;
  shadcn: ShadcnDiscovery;
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

const findProjectRoot = async (cwd: string): Promise<string> => {
  let currentDir = path.resolve(cwd);

  while (true) {
    if (await fileExists(path.join(currentDir, "package.json"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      throw new ProjectDiscoveryError(`No package.json found from ${cwd}.`);
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

const detectPackageManager = async (
  rootDir: string
): Promise<ProjectDiscovery["packageManager"]> => {
  if (await fileExists(path.join(rootDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (await fileExists(path.join(rootDir, "yarn.lock"))) {
    return "yarn";
  }

  if (await fileExists(path.join(rootDir, "package-lock.json"))) {
    return "npm";
  }

  if (await fileExists(path.join(rootDir, "bun.lockb"))) {
    return "bun";
  }

  return "unknown";
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

const detectFramework = ({
  appDir,
  dependencies,
  rootDir,
  viteEntry,
}: {
  appDir: string | null;
  dependencies: Record<string, string>;
  rootDir: string;
  viteEntry: string | null;
}): FrameworkDiscovery => {
  const evidence: string[] = [];

  if (dependencies.next && appDir) {
    evidence.push("next dependency found");
    evidence.push(
      `app router directory found at ${path.relative(rootDir, appDir)}`
    );

    return {
      adapter: "next-app-router",
      evidence,
    };
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

const discoverProject = async (cwd: string): Promise<ProjectDiscovery> => {
  const rootDir = await findProjectRoot(cwd);
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = await readJson(packageJsonPath);
  const dependencies = getDependencies(packageJson);

  if (!dependencies.react) {
    throw new ProjectDiscoveryError(
      "The nearest package does not declare React; run Shadscan from a React application package.",
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
  const viteEntry = await detectViteEntry(rootDir);
  const framework = detectFramework({
    appDir,
    dependencies,
    rootDir,
    viteEntry,
  });
  const tailwindCss = await detectTailwindCss(rootDir, shadcnConfig);
  const tsconfig = path.join(rootDir, "tsconfig.json");
  const srcDir = path.join(rootDir, "src");
  const packageName =
    typeof packageJson.name === "string" ? packageJson.name : null;

  return {
    dependencies,
    framework,
    packageManager: await detectPackageManager(rootDir),
    packageName,
    paths: {
      appDir,
      packageJson: packageJsonPath,
      srcDir: (await fileExists(srcDir)) ? srcDir : null,
      tailwindCss,
      tsconfig: (await fileExists(tsconfig)) ? tsconfig : null,
      viteEntry,
    },
    rootDir,
    scripts: getStringRecord(packageJson.scripts),
    shadcn: {
      aliases: getStringRecord(shadcnConfig?.aliases),
      configPath: shadcnConfig ? componentsJsonPath : null,
      confidence: shadcnConfidence,
      style:
        typeof shadcnConfig?.style === "string" ? shadcnConfig.style : null,
    },
    versions: {
      next: dependencies.next ?? null,
      react: dependencies.react ?? null,
      vite: dependencies.vite ?? null,
    },
    warnings,
  };
};

export type {
  Confidence,
  FrameworkAdapter,
  ProjectDiscovery,
  ProjectDiscoveryErrorCode,
};
export { discoverProject, ProjectDiscoveryError };
