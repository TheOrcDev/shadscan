import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { type ParseError, parse } from "jsonc-parser";
import { compareCodeUnits } from "./deterministic-order";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;
const MAX_USER_IGNORE_PATTERNS = 32;
const MAX_IGNORE_PATTERN_LENGTH = 256;
const CONFIG_FILE_NAMES = [
  "shadscan.config.jsonc",
  "shadscan.config.json",
] as const;

/**
 * Built-in exclusions that always apply. User patterns can only add to this
 * list; negation globs cannot put `node_modules` or `dist` back in.
 */
const BUILTIN_PROJECT_IGNORES = [
  "**/.astro/**",
  "**/.next/**",
  "**/__fixtures__/**",
  "**/__mocks__/**",
  "**/__tests__/**",
  "**/coverage/**",
  "**/dist/**",
  "**/fixtures/**",
  "**/generated/**",
  "**/node_modules/**",
  "**/routeTree.gen.ts",
  "**/vendor/**",
  "**/*.{spec,test}.{js,jsx,ts,tsx}",
  "**/*.stories.{js,jsx,ts,tsx}",
  "**/*.generated.{js,jsx,ts,tsx}",
] as const;

class ScanConfigError extends Error {
  readonly code = "INVALID_SCAN_CONFIG" as const;

  constructor(message: string) {
    super(message);
    this.name = "ScanConfigError";
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

const parseJsoncObject = (content: string, label: string): object => {
  const errors: ParseError[] = [];
  const value: unknown = parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (errors.length > 0 || value === undefined) {
    throw new ScanConfigError(`${label} could not be parsed.`);
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ScanConfigError(`${label} must be a JSON object.`);
  }

  return value;
};

const normalizeIgnorePattern = (value: string, label: string): string => {
  const pattern = value.trim().replaceAll("\\", "/");

  if (pattern.length === 0) {
    throw new ScanConfigError(`${label} must not be empty.`);
  }

  if (pattern.length > MAX_IGNORE_PATTERN_LENGTH) {
    throw new ScanConfigError(
      `${label} must be at most ${MAX_IGNORE_PATTERN_LENGTH} characters.`
    );
  }

  if (pattern.startsWith("!")) {
    throw new ScanConfigError(
      `${label} cannot use a negation glob; built-in ignores always apply.`
    );
  }

  if (pattern.startsWith("/") || WINDOWS_ABSOLUTE_PATH_PATTERN.test(pattern)) {
    throw new ScanConfigError(`${label} must be a project-relative glob.`);
  }

  if (pattern.split("/").includes("..")) {
    throw new ScanConfigError(`${label} must not contain parent segments.`);
  }

  return pattern;
};

const normalizeIgnorePatterns = (values: unknown, label: string): string[] => {
  if (!Array.isArray(values)) {
    throw new ScanConfigError(`${label} must be an array of glob strings.`);
  }

  if (values.length > MAX_USER_IGNORE_PATTERNS) {
    throw new ScanConfigError(
      `${label} is limited to ${MAX_USER_IGNORE_PATTERNS} patterns.`
    );
  }

  const patterns = values.map((value, index) => {
    if (typeof value !== "string") {
      throw new ScanConfigError(`${label}[${index}] must be a string.`);
    }

    return normalizeIgnorePattern(value, `${label}[${index}]`);
  });

  return [...new Set(patterns)].sort(compareCodeUnits);
};

const readScanConfigIgnores = async (rootDir: string): Promise<string[]> => {
  const presentConfigFiles: string[] = [];

  for (const fileName of CONFIG_FILE_NAMES) {
    if (await fileExists(path.join(rootDir, fileName))) {
      presentConfigFiles.push(fileName);
    }
  }

  if (presentConfigFiles.length > 1) {
    throw new ScanConfigError(
      "Found both shadscan.config.jsonc and shadscan.config.json; keep only one."
    );
  }

  const configFileName = presentConfigFiles[0];

  if (configFileName) {
    const configPath = path.join(rootDir, configFileName);
    const config = parseJsoncObject(
      await readFile(configPath, "utf8"),
      configFileName
    );
    const unknownKeys = Object.keys(config).filter((key) => key !== "ignore");

    if (unknownKeys.length > 0) {
      throw new ScanConfigError(
        `${configFileName} only supports an "ignore" array; found ${unknownKeys.sort(compareCodeUnits).join(", ")}.`
      );
    }

    if (!("ignore" in config)) {
      return [];
    }

    return normalizeIgnorePatterns(config.ignore, `${configFileName} "ignore"`);
  }

  const packageJsonPath = path.join(rootDir, "package.json");

  if (!(await fileExists(packageJsonPath))) {
    return [];
  }

  let packageJson: unknown;

  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    return [];
  }

  if (
    packageJson === null ||
    typeof packageJson !== "object" ||
    Array.isArray(packageJson) ||
    !("shadscan" in packageJson)
  ) {
    return [];
  }

  const shadscanConfig = packageJson.shadscan;

  if (
    shadscanConfig === null ||
    typeof shadscanConfig !== "object" ||
    Array.isArray(shadscanConfig)
  ) {
    throw new ScanConfigError(
      'package.json "shadscan" must be an object with an optional "ignore" array.'
    );
  }

  const unknownKeys = Object.keys(shadscanConfig).filter(
    (key) => key !== "ignore"
  );

  if (unknownKeys.length > 0) {
    throw new ScanConfigError(
      `package.json "shadscan" only supports an "ignore" array; found ${unknownKeys.sort(compareCodeUnits).join(", ")}.`
    );
  }

  if (!("ignore" in shadscanConfig)) {
    return [];
  }

  return normalizeIgnorePatterns(
    shadscanConfig.ignore,
    'package.json "shadscan.ignore"'
  );
};

const mergeIgnorePatterns = (
  ...groups: readonly (readonly string[])[]
): string[] => [...new Set(groups.flat())].sort(compareCodeUnits);

const resolveProjectIgnorePatterns = async ({
  cliIgnorePatterns = [],
  rootDir,
}: {
  cliIgnorePatterns?: readonly string[];
  rootDir: string;
}): Promise<string[]> => {
  const configPatterns = await readScanConfigIgnores(rootDir);
  const cliPatterns = normalizeIgnorePatterns(
    [...cliIgnorePatterns],
    "--ignore"
  );

  return mergeIgnorePatterns(configPatterns, cliPatterns);
};

const getAppliedIgnorePatterns = (
  extraIgnorePatterns: readonly string[]
): string[] =>
  mergeIgnorePatterns(BUILTIN_PROJECT_IGNORES, extraIgnorePatterns);

export {
  BUILTIN_PROJECT_IGNORES,
  getAppliedIgnorePatterns,
  mergeIgnorePatterns,
  normalizeIgnorePatterns,
  resolveProjectIgnorePatterns,
  ScanConfigError,
};
