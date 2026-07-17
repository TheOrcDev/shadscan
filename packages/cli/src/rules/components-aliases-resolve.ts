import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "jsonc-parser";
import type { AuditRule } from "../audit";
import { fail, notApplicable, pass } from "./rule-result";

type JsonObject = Record<string, unknown>;

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
  configPath: string;
  mappings: Record<string, string[]>;
} | null> => {
  const configPath = tsconfigPath ?? path.join(rootDir, "jsconfig.json");

  if (!(await fileExists(configPath))) {
    return null;
  }

  const parsedConfig: unknown = parse(await readFile(configPath, "utf8"));

  if (
    !parsedConfig ||
    typeof parsedConfig !== "object" ||
    Array.isArray(parsedConfig)
  ) {
    return { configPath, mappings: {} };
  }

  const config = parsedConfig as JsonObject;
  const compilerOptions = config.compilerOptions;

  if (
    !compilerOptions ||
    typeof compilerOptions !== "object" ||
    Array.isArray(compilerOptions)
  ) {
    return { configPath, mappings: {} };
  }

  const paths = (compilerOptions as JsonObject).paths;

  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    return { configPath, mappings: {} };
  }

  const mappings: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(paths)) {
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      mappings[key] = value;
    }
  }

  return { configPath, mappings };
};

const mappingMatchesAlias = (mapping: string, alias: string): boolean => {
  const wildcardIndex = mapping.indexOf("*");

  if (wildcardIndex === -1) {
    return mapping === alias;
  }

  const prefix = mapping.slice(0, wildcardIndex);
  const suffix = mapping.slice(wildcardIndex + 1);

  return alias.startsWith(prefix) && alias.endsWith(suffix);
};

const isResolvableAlias = (
  alias: string,
  mappings: Record<string, string[]>
): boolean => {
  if (alias.startsWith("./") || alias.startsWith("../")) {
    return true;
  }

  return Object.keys(mappings).some((mapping) =>
    mappingMatchesAlias(mapping, alias)
  );
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

    const unresolvedAliases = aliases.filter(
      ([, alias]) => !isResolvableAlias(alias, pathMappings.mappings)
    );

    if (unresolvedAliases.length > 0) {
      const names = unresolvedAliases
        .map(([name, alias]) => `${name} (${alias})`)
        .join(", ");

      return fail(
        `Unresolved shadcn aliases: ${names}.`,
        "Add matching compilerOptions.paths entries or change the aliases in components.json.",
        { filePath: pathMappings.configPath }
      );
    }

    return pass(
      `All ${aliases.length} shadcn aliases match configured path mappings.`,
      pathMappings.configPath
    );
  },
  severity: "warning",
  title: "shadcn aliases resolve",
};

export { componentsAliasesResolveRule };
