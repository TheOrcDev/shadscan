import { access } from "node:fs/promises";
import path from "node:path";
import {
  type CompilerOptions,
  getParsedCommandLineOfConfigFile,
  type ParseConfigFileHost,
  sys,
} from "typescript";
import type { AuditRule } from "../audit";
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

const parseConfigHost: ParseConfigFileHost = {
  ...sys,
  onUnRecoverableConfigFileDiagnostic: () => undefined,
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const getPathMappings = async (
  rootDir: string,
  tsconfigPath: string | null
): Promise<{
  basePath: string;
  configPath: string;
  mappings: Record<string, string[]>;
} | null> => {
  const configPath = tsconfigPath ?? path.join(rootDir, "jsconfig.json");

  if (!(await fileExists(configPath))) {
    return null;
  }

  const parsedConfig = getParsedCommandLineOfConfigFile(
    configPath,
    {},
    parseConfigHost
  );
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

const targetExists = async (targetPath: string): Promise<boolean> => {
  for (const suffix of MODULE_CANDIDATE_SUFFIXES) {
    if (await fileExists(`${targetPath}${suffix}`)) {
      return true;
    }
  }

  return false;
};

const isResolvableAlias = async (
  alias: string,
  rootDir: string,
  pathMappings: NonNullable<Awaited<ReturnType<typeof getPathMappings>>>
): Promise<boolean> => {
  if (alias.startsWith("./") || alias.startsWith("../")) {
    return targetExists(path.resolve(rootDir, alias));
  }

  for (const [mapping, targets] of Object.entries(pathMappings.mappings)) {
    const capture = getMappingCapture(mapping, alias);

    if (capture === null) {
      continue;
    }

    for (const target of targets) {
      const mappedTarget = target.replace("*", capture);

      if (
        await targetExists(path.resolve(pathMappings.basePath, mappedTarget))
      ) {
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
  run: async ({ project }) => {
    const aliases = Object.entries(project.shadcn.aliases);

    if (aliases.length === 0) {
      return notApplicable(
        "No parsed shadcn aliases were available to validate."
      );
    }

    const pathMappings = await getPathMappings(
      project.rootDir,
      project.paths.tsconfig
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
        !(await isResolvableAlias(aliasEntry[1], project.rootDir, pathMappings))
      ) {
        unresolvedAliases.push(aliasEntry);
      }
    }

    if (unresolvedAliases.length > 0) {
      const names = unresolvedAliases
        .map(([name, alias]) => `${name} (${alias})`)
        .join(", ");

      return fail(
        `Shadcn aliases without existing targets: ${names}.`,
        "Add matching compilerOptions.paths entries that point to existing files or directories, or change the aliases in components.json.",
        { filePath: pathMappings.configPath }
      );
    }

    return pass(
      `All ${aliases.length} shadcn aliases resolve to existing configured targets.`,
      pathMappings.configPath
    );
  },
  severity: "warning",
  title: "shadcn aliases resolve",
};

export { componentsAliasesResolveRule };
