import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";
import { compareCodeUnits } from "./deterministic-order";
import {
  discoverProject,
  type FrameworkAdapter,
  fileExists,
  ProjectDiscoveryError,
} from "./discovery";

interface PackageManifest {
  exports?: unknown;
  main?: unknown;
  module?: unknown;
  workspaces?: unknown;
}

/** Discovery must survive an unreadable or malformed manifest, not throw. */
const readPackageManifest = async (
  filePath: string
): Promise<PackageManifest | null> => {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as PackageManifest;
  } catch {
    return null;
  }
};

/**
 * Workspace manifests are detected by presence only. Parsing their globs
 * would need a YAML parser the CLI deliberately does not ship, and walking
 * the tree for `package.json` files answers the same question for pnpm,
 * npm, yarn, bun, Turborepo, Nx and Lerna uniformly — which also keeps the
 * CLI's project list identical to the hosted scanner's.
 */
const WORKSPACE_MARKERS = [
  { file: "pnpm-workspace.yaml", kind: "pnpm" },
  { file: "lerna.json", kind: "lerna" },
  { file: "nx.json", kind: "nx" },
  { file: "turbo.json", kind: "turbo" },
] as const;

type WorkspaceKind = "lerna" | "npm" | "nx" | "pnpm" | "turbo" | "none";

type WorkspaceProjectKind = "application" | "library";

interface WorkspaceProject {
  adapter: FrameworkAdapter;
  kind: WorkspaceProjectKind;
  kindReason: string;
  packageDir: string;
  packageName: string | null;
}

interface WorkspaceSkip {
  packageDir: string;
  reason: string;
}

interface WorkspaceDiscovery {
  kind: WorkspaceKind;
  projects: WorkspaceProject[];
  rootDir: string;
  skipped: WorkspaceSkip[];
  truncated: number;
}

/**
 * Sequential scanning of every application builds one render graph each, so
 * the cap is a wall-clock guard rather than a correctness one. Anything
 * dropped is reported; silent truncation reads as "we audited everything".
 */
const MAX_APPLICATION_PROJECTS = 25;

/**
 * Mirrors the scanner's own source ignores. Test scaffolding contains real
 * `package.json` files describing real frameworks — `shadcn-ui/ui` ships two
 * dozen of them — and treating those as applications would pool a repository's
 * test fixtures into its score. If the scanner will not read source from a
 * directory, discovery must not call it a project either.
 */
const PACKAGE_IGNORES = [
  "**/node_modules/**",
  "**/.next/**",
  "**/.astro/**",
  "**/__fixtures__/**",
  "**/__mocks__/**",
  "**/__tests__/**",
  "**/build/**",
  "**/coverage/**",
  "**/dist/**",
  "**/fixtures/**",
  "**/vendor/**",
];

/** Adapters that only win detection when the package owns a document shell. */
const APPLICATION_ADAPTERS = new Set<FrameworkAdapter>([
  "astro-react",
  "laravel-inertia-react",
  "next-app-router",
  "next-hybrid-router",
  "next-pages-router",
  "react-router-framework",
  "tanstack-start",
  "vite-react",
]);

const APP_ENTRY_CANDIDATES = [
  "index.html",
  "app",
  "pages",
  "src/app",
  "src/pages",
];

/** Workspace-relative, always posix — report paths must not vary by platform. */
const toPackageDir = (rootDir: string, projectDir: string): string => {
  const relative = path.relative(rootDir, projectDir);

  if (relative === "") {
    return ".";
  }

  return relative.split(path.sep).join("/");
};

const detectWorkspaceKind = async (rootDir: string): Promise<WorkspaceKind> => {
  for (const marker of WORKSPACE_MARKERS) {
    if (await fileExists(path.join(rootDir, marker.file))) {
      return marker.kind;
    }
  }

  const manifest = await readPackageManifest(
    path.join(rootDir, "package.json")
  );

  return manifest && Array.isArray(manifest.workspaces) ? "npm" : "none";
};

const hasAppEntry = async (projectDir: string): Promise<boolean> => {
  for (const candidate of APP_ENTRY_CANDIDATES) {
    if (await fileExists(path.join(projectDir, candidate))) {
      return true;
    }
  }

  return false;
};

/**
 * A React library scores zero on every document-shell rule it should never
 * satisfy, so pooling it with applications would punish a repository for
 * owning a design system. Classification decides pooling and is therefore
 * always reported with its reason rather than applied silently.
 *
 * The deciding signal is an application entry point, not a `main`/`exports`
 * field. Internal workspace packages are routinely consumed straight from
 * source through a path alias and declare no entry at all; keying off the
 * manifest classified those as applications and let a design system drag an
 * entire workspace's score down — the exact outcome this split exists to
 * prevent. Every application has an entry point, so its absence is the
 * reliable half of the test.
 */
const classifyProject = async (
  projectDir: string,
  adapter: FrameworkAdapter
): Promise<{ kind: WorkspaceProjectKind; reason: string }> => {
  if (APPLICATION_ADAPTERS.has(adapter)) {
    return {
      kind: "application",
      reason: `The ${adapter} adapter implies an application shell.`,
    };
  }

  if (await hasAppEntry(projectDir)) {
    return {
      kind: "application",
      reason: "Generic React package with an application entry point.",
    };
  }

  return {
    kind: "library",
    reason: `Generic React package with no application entry point (${APP_ENTRY_CANDIDATES.join(", ")}).`,
  };
};

const findPackageDirs = async (rootDir: string): Promise<string[]> => {
  const manifests = await glob("**/package.json", {
    absolute: true,
    cwd: rootDir,
    dot: false,
    ignore: PACKAGE_IGNORES,
    onlyFiles: true,
  });

  const dirs = new Set<string>();
  for (const manifest of manifests) {
    dirs.add(path.dirname(path.resolve(manifest)));
  }

  return [...dirs].sort((left, right) =>
    compareCodeUnits(toPackageDir(rootDir, left), toPackageDir(rootDir, right))
  );
};

const getSkipReason = (error: unknown): string => {
  if (error instanceof ProjectDiscoveryError) {
    return error.message;
  }

  return error instanceof Error
    ? error.message
    : "The package could not be inspected.";
};

/**
 * Enumerates every package in the tree that shadscan can audit. Packages that
 * cannot be discovered — no React, unreadable manifest — become `skipped`
 * entries so one bad package never fails a workspace run.
 */
const discoverWorkspace = async (
  rootDir: string,
  filesystemRoot?: string
): Promise<WorkspaceDiscovery> => {
  const resolvedRoot = path.resolve(rootDir);
  const kind = await detectWorkspaceKind(resolvedRoot);
  const packageDirs = await findPackageDirs(resolvedRoot);
  const projects: WorkspaceProject[] = [];
  const skipped: WorkspaceSkip[] = [];

  for (const projectDir of packageDirs) {
    const packageDir = toPackageDir(resolvedRoot, projectDir);

    try {
      const project = await discoverProject(projectDir, {
        filesystemRoot: filesystemRoot ?? resolvedRoot,
      });
      const { kind: projectKind, reason } = await classifyProject(
        projectDir,
        project.framework.adapter
      );

      projects.push({
        adapter: project.framework.adapter,
        kind: projectKind,
        kindReason: reason,
        packageDir,
        packageName: project.packageName,
      });
    } catch (error) {
      skipped.push({ packageDir, reason: getSkipReason(error) });
    }
  }

  let truncated = 0;
  const kept: WorkspaceProject[] = [];
  let applicationCount = 0;
  for (const project of projects) {
    if (project.kind === "library") {
      kept.push(project);
      continue;
    }

    if (applicationCount >= MAX_APPLICATION_PROJECTS) {
      truncated += 1;
      continue;
    }

    applicationCount += 1;
    kept.push(project);
  }

  return { kind, projects: kept, rootDir: resolvedRoot, skipped, truncated };
};

export type {
  WorkspaceDiscovery,
  WorkspaceKind,
  WorkspaceProject,
  WorkspaceProjectKind,
  WorkspaceSkip,
};
export { discoverWorkspace, MAX_APPLICATION_PROJECTS };
