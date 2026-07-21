import path from "node:path";
import {
  type CompilerOptions,
  getParsedCommandLineOfConfigFile,
} from "typescript";
import type { AuditRule } from "../audit";
import {
  type ConfinedTypeScriptHost,
  createConfinedTypeScriptHost,
} from "../typescript-host";
import { fail, notApplicable, pass } from "./rule-result";

type CompilerOptionsWithPathsBase = CompilerOptions & {
  pathsBasePath?: string;
};

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
  ".json",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
] as const;

const getPathMappings = (
  rootDir: string,
  tsconfigPath: string | null,
  host: ConfinedTypeScriptHost
): {
  basePath: string;
  configPath: string;
  mappings: Record<string, string[]>;
} | null => {
  const configPath = tsconfigPath ?? path.join(rootDir, "jsconfig.json");

  if (!host.fileExists(configPath)) {
    return null;
  }

  const parsedConfig = getParsedCommandLineOfConfigFile(configPath, {}, host);
  const options = parsedConfig?.options as
    | CompilerOptionsWithPathsBase
    | undefined;
  const configuredBasePath =
    options?.baseUrl ?? options?.pathsBasePath ?? path.dirname(configPath);

  return {
    basePath: path.resolve(configuredBasePath),
    configPath,
    mappings: options?.paths ?? {},
  };
};

const getMappingCapture = (mapping: string, alias: string): string | null => {
  const wildcardIndex = mapping.indexOf("*");

  if (wildcardIndex === -1) {
    return mapping === alias ? "" : null;
  }

  const prefix = mapping.slice(0, wildcardIndex);
  const suffix = mapping.slice(wildcardIndex + 1);

  if (!(alias.startsWith(prefix) && alias.endsWith(suffix))) {
    return null;
  }

  return alias.slice(prefix.length, alias.length - suffix.length || undefined);
};

const targetExists = (
  targetPath: string,
  host: ConfinedTypeScriptHost
): boolean => {
  for (const suffix of MODULE_CANDIDATE_SUFFIXES) {
    if (host.pathExists(`${targetPath}${suffix}`)) {
      return true;
    }
  }

  return false;
};

const mappingTargetExists = (
  target: string,
  basePath: string,
  capture: string,
  host: ConfinedTypeScriptHost
): boolean => {
  const wildcardIndex = target.indexOf("*");

  if (wildcardIndex === -1) {
    return targetExists(path.resolve(basePath, target), host);
  }

  const mappedTarget = target.replace("*", capture);
  if (targetExists(path.resolve(basePath, mappedTarget), host)) {
    return true;
  }

  const targetRoot = target.slice(0, wildcardIndex);
  return host.pathExists(path.resolve(basePath, targetRoot));
};

const isResolvableAlias = (
  alias: string,
  rootDir: string,
  host: ConfinedTypeScriptHost,
  pathMappings: NonNullable<ReturnType<typeof getPathMappings>>
): boolean => {
  if (alias.startsWith("./") || alias.startsWith("../")) {
    return targetExists(path.resolve(rootDir, alias), host);
  }

  for (const [mapping, targets] of Object.entries(pathMappings.mappings)) {
    const capture = getMappingCapture(mapping, alias);

    if (capture === null) {
      continue;
    }

    for (const target of targets) {
      if (mappingTargetExists(target, pathMappings.basePath, capture, host)) {
        return true;
      }
    }
  }

  return false;
};

const componentsAliasesResolveRule: AuditRule = {
  adapters: ["core"],
  category: "foundation",
  confidence: "high",
  description:
    "Checks whether shadcn aliases can be resolved through TypeScript or JavaScript path mappings.",
  id: "components-aliases-resolve",
  maxScore: 2,
  run: ({ filesystemRoot, project }) => {
    const aliases = Object.entries(project.shadcn.aliases);

    if (aliases.length === 0) {
      return notApplicable(
        "No parsed shadcn aliases were available to validate."
      );
    }

    const host = createConfinedTypeScriptHost(filesystemRoot);
    const pathMappings = getPathMappings(
      project.rootDir,
      project.paths.tsconfig,
      host
    );

    if (!pathMappings) {
      return fail(
        "Shadcn aliases are configured, but no tsconfig.json or jsconfig.json path mappings were found.",
        "Add compilerOptions.paths entries that resolve the aliases declared in components.json.",
        { filePath: project.shadcn.configPath ?? undefined }
      );
    }

    const unresolvedAliases: typeof aliases = [];

    for (const aliasEntry of aliases) {
      if (
        !isResolvableAlias(aliasEntry[1], project.rootDir, host, pathMappings)
      ) {
        unresolvedAliases.push(aliasEntry);
      }
    }

    if (unresolvedAliases.length > 0) {
      const names = unresolvedAliases
        .map(([name, alias]) => `${name} (${alias})`)
        .join(", ");

      return fail(
        `Shadcn aliases without resolvable mapping roots: ${names}.`,
        "Add matching compilerOptions.paths entries whose mapping roots exist, or change the aliases in components.json.",
        { filePath: pathMappings.configPath }
      );
    }

    return pass(
      `All ${aliases.length} shadcn aliases have resolvable configured mapping roots.`,
      pathMappings.configPath
    );
  },
  severity: "warning",
  title: "shadcn aliases resolve",
};

export { componentsAliasesResolveRule };
