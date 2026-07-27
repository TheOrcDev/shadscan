import path from "node:path";
import {
  type CompilerOptions,
  getParsedCommandLineOfConfigFile,
  resolveModuleName,
} from "typescript";
import type { ProjectDiscovery } from "../discovery";
import {
  type ConfinedTypeScriptHost,
  createConfinedTypeScriptHost,
} from "../typescript-host";

/**
 * Extension and index shapes a bundler alias may omit. Ordered so an exact
 * path wins before an extension guess, and a file wins before a directory
 * index.
 */
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

const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`;

interface ProjectModuleResolver {
  compilerOptions: CompilerOptions;
  host: ConfinedTypeScriptHost;
}

interface ResolveProjectModulePathOptions {
  containingFile: string;
  /**
   * Membership test against the caller's own file index. Resolution only
   * succeeds for files the caller already parsed, so a rule never reasons
   * about a file outside its scanned set.
   */
  hasCandidate: (candidatePath: string) => boolean;
  moduleName: string;
  project: ProjectDiscovery;
  resolver: ProjectModuleResolver;
}

const resolverCache = new WeakMap<
  ProjectDiscovery,
  Map<string, ProjectModuleResolver>
>();

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

/**
 * Builds — and reuses — the confined host and parsed compiler options for a
 * project. Reading tsconfig once per scan instead of once per rule is the
 * only behavior this sharing changes.
 */
const getProjectModuleResolver = (
  project: ProjectDiscovery,
  filesystemRoot: string
): ProjectModuleResolver => {
  const byRoot = resolverCache.get(project) ?? new Map();
  const cached = byRoot.get(filesystemRoot);

  if (cached) {
    return cached;
  }

  const host = createConfinedTypeScriptHost(filesystemRoot);
  const resolver: ProjectModuleResolver = {
    compilerOptions: getCompilerOptions(project, host),
    host,
  };

  byRoot.set(filesystemRoot, resolver);
  resolverCache.set(project, byRoot);

  return resolver;
};

const findCandidatePath = (
  candidatePath: string,
  hasCandidate: (candidate: string) => boolean
): string | null => {
  for (const suffix of MODULE_CANDIDATE_SUFFIXES) {
    const candidate = path.resolve(`${candidatePath}${suffix}`);

    if (hasCandidate(candidate)) {
      return candidate;
    }
  }

  return null;
};

const resolveThroughTypeScript = ({
  containingFile,
  hasCandidate,
  moduleName,
  resolver,
}: ResolveProjectModulePathOptions): string | null => {
  const resolvedFileName = resolveModuleName(
    moduleName,
    containingFile,
    resolver.compilerOptions,
    resolver.host
  ).resolvedModule?.resolvedFileName;

  if (
    !(
      resolvedFileName &&
      resolver.host.isPathAllowed(resolvedFileName) &&
      !resolvedFileName.includes(NODE_MODULES_SEGMENT)
    )
  ) {
    return null;
  }

  const resolvedPath = path.resolve(resolvedFileName);

  return hasCandidate(resolvedPath) ? resolvedPath : null;
};

/**
 * Resolves an import specifier to a project file the caller already indexed,
 * or null. TypeScript's own resolver runs first so tsconfig `paths` win;
 * relative and `@/` specifiers fall back to a suffix search for projects that
 * declare their alias only to the bundler.
 *
 * Never leaves the scan boundary: the confined host rejects paths outside the
 * filesystem root, node_modules is excluded, and an unindexed file is treated
 * as unresolved rather than read from disk.
 */
const resolveProjectModulePath = (
  options: ResolveProjectModulePathOptions
): string | null => {
  const resolved = resolveThroughTypeScript(options);

  if (resolved) {
    return resolved;
  }

  const { containingFile, hasCandidate, moduleName, project } = options;

  if (moduleName.startsWith(".")) {
    return findCandidatePath(
      path.resolve(path.dirname(containingFile), moduleName),
      hasCandidate
    );
  }

  if (moduleName.startsWith("@/")) {
    return findCandidatePath(
      path.resolve(project.rootDir, moduleName.slice(2)),
      hasCandidate
    );
  }

  return null;
};

export type { ProjectModuleResolver };
export {
  getCompilerOptions,
  getProjectModuleResolver,
  MODULE_CANDIDATE_SUFFIXES,
  resolveProjectModulePath,
};
