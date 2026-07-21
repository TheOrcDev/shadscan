// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: This module intentionally branches conservatively across independent Git-hook safety states.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { sanitizeTerminalText } from "./render-human";

type PackageManager = "bun" | "npm" | "pnpm" | "unknown" | "yarn";
type PreCommitManager =
  | "husky"
  | "lefthook"
  | "native"
  | "pre-commit"
  | "simple-git-hooks";
type PreCommitProtectionStatus =
  | "absent"
  | "conflict"
  | "integrable"
  | "protected-active"
  | "unavailable";
type PreCommitPlanMode = "automatic" | "manual" | "not-needed";
type PreCommitErrorCode =
  | "CONFIRMATION_REQUIRED"
  | "INVALID_SCORE"
  | "INVALID_VERSION"
  | "MANUAL_REQUIRED"
  | "STALE_PLAN"
  | "UNSAFE_PATH"
  | "WRITE_FAILED";

interface GitCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

type GitCommandRunner = (
  args: readonly string[],
  cwd: string
) => Promise<GitCommandResult>;

interface DetectPreCommitProtectionOptions {
  projectRoot: string;
  runGit?: GitCommandRunner;
}

interface PreCommitHookSnapshot {
  content: string | null;
  executable: boolean;
  exists: boolean;
  kind: "directory" | "missing" | "regular" | "symlink" | "unsupported";
  mode: number | null;
  path: string;
}

interface PreCommitProtection {
  activeHookPath: string | null;
  configPaths: string[];
  coreHooksPath: string | null;
  effectiveHooksPath: string | null;
  floor: number | null;
  gitRoot: string | null;
  hookSource: PreCommitHookSnapshot | null;
  manager: PreCommitManager | null;
  managers: PreCommitManager[];
  projectRoot: string;
  reason: string;
  status: PreCommitProtectionStatus;
}

interface CreatePreCommitInstallPlanOptions
  extends DetectPreCommitProtectionOptions {
  detection?: PreCommitProtection;
  packageManager: PackageManager;
  score: number;
  version: string;
}

interface PreCommitFileChange {
  after: string;
  before: string | null;
  mode: number;
  operation: "create" | "update";
  path: string;
}

interface PreCommitInstallPlan {
  changes: PreCommitFileChange[];
  command: string | null;
  detection: PreCommitProtection;
  manager: PreCommitManager | null;
  manualSteps: string[];
  mode: PreCommitPlanMode;
  packageManager: PackageManager;
  projectRoot: string;
  reason: string;
  runGit: GitCommandRunner;
  score: number;
  version: string;
}

interface ApplyPreCommitInstallPlanOptions {
  confirmed: boolean;
}

interface ApplyPreCommitInstallPlanResult {
  alreadyApplied: boolean;
  changedPaths: string[];
}

interface JsonObject {
  [key: string]: unknown;
}

interface ManagerConfig {
  content: string | null;
  manager: Exclude<PreCommitManager, "native">;
  opaque: boolean;
  path: string;
  protectedFloor: number | null;
}

interface ProtectionScanTarget {
  allowScriptIndirection: boolean;
  gitRoot: string;
  projectRoot: string;
}

interface PackageMetadata {
  object: JsonObject;
  path: string;
  scripts: Record<string, string>;
}

const BEGIN_MARKER = "# >>> shadscan pre-commit >>>";
const END_MARKER = "# <<< shadscan pre-commit <<<";
const MAX_HOOK_BYTES = 128 * 1024;
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;
const EXACT_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const SAFE_SHELL_ARGUMENT_PATTERN = /^[A-Za-z0-9_./:@+-]+$/;
const TRAILING_LINE_BREAKS_PATTERN = /[\r\n]+$/u;
const LINE_BREAK_PATTERN = /\r?\n/u;
const ARGUMENT_SEPARATOR_PATTERN = /\s+/u;
const YAML_RUN_PATTERN = /^\s*(?:entry|run):\s*(.+?)\s*$/u;
const HUSKY_PREPARE_PATTERN = /(?:^|\s)husky(?:\s|$)/u;
const JAVASCRIPT_CONFIG_PATTERN = /\.(?:c|m)?js$/u;
const HUSKY_WRAPPER_PATTERN = /\bhusky\b/iu;
const LEFTHOOK_WRAPPER_PATTERN = /\blefthook\b/iu;
const SIMPLE_GIT_HOOKS_WRAPPER_PATTERN = /simple-git-hooks/iu;
const PRE_COMMIT_WRAPPER_PATTERN =
  /\bpre_commit\b|INSTALL_PYTHON|pre-commit\.com/iu;
const SHADSCAN_TOKEN_PATTERN =
  /(?:^|[\s"'`;&|()])(?:[^\s"'`;&|()]*(?:\/|\\))?shadscan(?:\.cmd)?(?=$|[\s"'`;&|()])|@shadscan\/cli@[0-9A-Za-z.+-]+/;
const DIRECT_SHADSCAN_COMMAND_PATTERN =
  /^(?:(?:[^\s"'`;&|()]+(?:\/|\\))?shadscan(?:\.cmd)?|bunx\s+@shadscan\/cli@[0-9A-Za-z.+-]+|pnpm\s+dlx\s+@shadscan\/cli@[0-9A-Za-z.+-]+|npx\s+--yes\s+@shadscan\/cli@[0-9A-Za-z.+-]+|yarn\s+dlx\s+--quiet\s+--package\s+@shadscan\/cli@[0-9A-Za-z.+-]+\s+shadscan)(?=\s|$)/u;
const BLOCKING_EXIT_SUFFIX_PATTERN = /\s+\|\|\s+exit\s+\$\?\s*$/u;
const SIMPLE_SHELL_COMMAND_PATTERN =
  /^[A-Za-z0-9_./:@+=-]+(?:\s+[A-Za-z0-9_./:@+=-]+)*$/u;
const SHELL_SHEBANG_PATTERN =
  /^#!\s*(?:\/usr\/bin\/env\s+(?:-S\s+)?|\/(?:usr\/)?bin\/)(?:da)?sh\s*$/u;
const OPAQUE_SHELL_PATTERN =
  /(?:^|\n)\s*(?:case|do|done|elif|else|esac|exec|exit|fi|for|function|if|return|select|then|until|while)\b|<<[-~]?\s*['"]?[A-Za-z_]/m;
const SHELL_STATE_MUTATING_COMMAND_PATTERN =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=|alias\b|builtin\b|cd\b|command\b|declare\b|enable\b|eval\b|exec\b|exit\b|export\b|hash\b|local\b|popd\b|pushd\b|readonly\b|return\b|set\b|shift\b|source\b|time\b|trap\b|typeset\b|umask\b|unalias\b|unset\b|\.\s+)/u;
const SAFE_SCAN_FLAG_OPTIONS = new Set([
  "--json",
  "--no-interactive",
  "--no-roast",
  "--prompt",
  "--roast",
]);
const SAFE_OUTPUT_FORMATS = new Set(["human", "json", "prompt"]);
const SCRIPT_COMMAND_PATTERNS = [
  /^(?:bun|npm|pnpm|yarn)\s+run\s+([A-Za-z0-9][A-Za-z0-9:._-]*)\s*$/u,
] as const;
const LEFTHOOK_CONFIG_NAMES = [
  "lefthook.yml",
  "lefthook.yaml",
  ".lefthook.yml",
  ".lefthook.yaml",
] as const;
const PRE_COMMIT_CONFIG_NAMES = [
  ".pre-commit-config.yaml",
  ".pre-commit-config.yml",
] as const;
const SIMPLE_GIT_HOOKS_CONFIG_NAMES = [
  ".simple-git-hooks.json",
  "simple-git-hooks.json",
  ".simple-git-hooks.cjs",
  ".simple-git-hooks.js",
  ".simple-git-hooks.mjs",
  "simple-git-hooks.cjs",
  "simple-git-hooks.js",
  "simple-git-hooks.mjs",
] as const;

class PreCommitError extends Error {
  readonly code: PreCommitErrorCode;

  constructor(code: PreCommitErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "PreCommitError";
  }
}

const defaultGitCommandRunner: GitCommandRunner = (
  args,
  cwd
): Promise<GitCommandResult> =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        encoding: "utf8",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        let exitCode = 0;

        if (error) {
          const errorCode = (error as NodeJS.ErrnoException).code;
          exitCode = typeof errorCode === "number" ? errorCode : 1;
        }

        resolve({
          exitCode,
          stderr: String(stderr),
          stdout: String(stdout),
        });
      }
    );
  });

const trimCommandOutput = (output: string): string =>
  output.replace(TRAILING_LINE_BREAKS_PATTERN, "");

const hasErrorCode = (error: unknown, expectedCode: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === expectedCode;

const isWithin = (root: string, candidate: string): boolean => {
  const relativePath = path.relative(root, candidate);

  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

const isSafeWritePath = async (
  gitRoot: string,
  targetPath: string
): Promise<boolean> => {
  if (!isWithin(gitRoot, targetPath)) {
    return false;
  }

  let canonicalGitRoot: string;

  try {
    canonicalGitRoot = await realpath(gitRoot);
  } catch {
    return false;
  }

  let candidateParent = path.dirname(targetPath);

  while (true) {
    try {
      const stats = await lstat(candidateParent);

      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        return false;
      }

      const canonicalParent = await realpath(candidateParent);
      return isWithin(canonicalGitRoot, canonicalParent);
    } catch (error) {
      if (!hasErrorCode(error, "ENOENT")) {
        return false;
      }

      const parent = path.dirname(candidateParent);
      if (parent === candidateParent) {
        return false;
      }
      candidateParent = parent;
    }
  }
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const readTextFile = async (filePath: string): Promise<string | null> => {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
};

const readJsonObject = async (filePath: string): Promise<JsonObject | null> => {
  const content = await readTextFile(filePath);

  if (content === null) {
    return null;
  }

  try {
    const value = JSON.parse(content) as unknown;

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as JsonObject;
  } catch {
    return null;
  }
};

const getStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record: Record<string, string> = {};

  for (const [name, childValue] of Object.entries(value)) {
    if (typeof childValue === "string") {
      record[name] = childValue;
    }
  }

  return record;
};

const readPackageMetadata = async (
  packageRoot: string
): Promise<PackageMetadata | null> => {
  const packagePath = path.join(packageRoot, "package.json");
  const object = await readJsonObject(packagePath);

  if (!object) {
    return null;
  }

  return {
    object,
    path: packagePath,
    scripts: getStringRecord(object.scripts),
  };
};

const mergePackageScripts = (
  projectPackage: PackageMetadata | null,
  rootPackage: PackageMetadata | null
): Record<string, string> => ({
  ...(rootPackage?.scripts ?? {}),
  ...(projectPackage?.scripts ?? {}),
});

const getDependencyNames = (packageObject: JsonObject): Set<string> => {
  const names = new Set<string>();

  for (const groupName of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    const group = packageObject[groupName];

    if (!group || typeof group !== "object" || Array.isArray(group)) {
      continue;
    }

    for (const dependencyName of Object.keys(group)) {
      names.add(dependencyName);
    }
  }

  return names;
};

const getExecutableLines = (content: string): string[] => {
  const logicalLines: string[] = [];
  let pending = "";

  for (const sourceLine of content.split(LINE_BREAK_PATTERN)) {
    const line = sourceLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const continued = line.endsWith("\\");
    const fragment = continued ? line.slice(0, -1).trimEnd() : line;
    pending = pending ? `${pending} ${fragment}` : fragment;

    if (!continued) {
      logicalLines.push(pending);
      pending = "";
    }
  }

  if (pending) {
    logicalLines.push(pending);
  }

  return logicalLines;
};

const getSimpleBlockingCommand = ({
  command,
  commandCount,
  commandIndex,
}: {
  command: string;
  commandCount: number;
  commandIndex: number;
}): string | null => {
  const hasBlockingExit = BLOCKING_EXIT_SUFFIX_PATTERN.test(command);

  if (!hasBlockingExit && commandIndex !== commandCount - 1) {
    return null;
  }

  const directCommand = hasBlockingExit
    ? command.replace(BLOCKING_EXIT_SUFFIX_PATTERN, "").trim()
    : command;

  if (!SIMPLE_SHELL_COMMAND_PATTERN.test(directCommand)) {
    return null;
  }

  return directCommand;
};

const parseFloorValue = (value: string): number | null => {
  const floor = Number(value);

  return Number.isInteger(floor) && floor >= 0 && floor <= 100 ? floor : null;
};

const parseDirectFloor = (
  command: string,
  target: ProtectionScanTarget
): number | null => {
  const commandMatch = DIRECT_SHADSCAN_COMMAND_PATTERN.exec(command);

  if (!commandMatch) {
    return null;
  }

  const argumentText = command.slice(commandMatch[0].length).trim();
  const args = argumentText
    ? argumentText.split(ARGUMENT_SEPARATOR_PATTERN)
    : [];
  let floor: number | null = null;
  let projectArgument: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (!argument) {
      continue;
    }

    if (SAFE_SCAN_FLAG_OPTIONS.has(argument)) {
      continue;
    }

    if (argument === "--format") {
      const format = args[index + 1];
      if (!(format && SAFE_OUTPUT_FORMATS.has(format))) {
        return null;
      }
      index += 1;
      continue;
    }

    if (argument.startsWith("--format=")) {
      if (!SAFE_OUTPUT_FORMATS.has(argument.slice("--format=".length))) {
        return null;
      }
      continue;
    }

    if (argument === "--fail-under") {
      if (floor !== null) {
        return null;
      }

      const value = args[index + 1];
      if (!value) {
        return null;
      }
      floor = parseFloorValue(value);
      if (floor === null) {
        return null;
      }
      index += 1;
      continue;
    }

    if (argument.startsWith("--fail-under=")) {
      if (floor !== null) {
        return null;
      }
      floor = parseFloorValue(argument.slice("--fail-under=".length));
      if (floor === null) {
        return null;
      }
      continue;
    }

    if (argument.startsWith("-")) {
      return null;
    }

    if (projectArgument !== null) {
      return null;
    }
    projectArgument = argument;
  }

  if (floor === null) {
    return null;
  }

  const resolvedTarget = projectArgument
    ? path.resolve(target.gitRoot, projectArgument)
    : path.resolve(target.gitRoot);

  return resolvedTarget === path.resolve(target.projectRoot) ? floor : null;
};

const getInvokedScripts = (command: string): string[] => {
  const names = new Set<string>();

  for (const pattern of SCRIPT_COMMAND_PATTERNS) {
    const scriptName = pattern.exec(command)?.[1];

    if (scriptName) {
      names.add(scriptName);
    }
  }

  return [...names];
};

const findProtectionFloor = (
  content: string,
  scripts: Record<string, string>,
  target: ProtectionScanTarget
): number | null => {
  const visitedScripts = new Set<string>();

  const contentHasSafeContext = (value: string, commands: string[]): boolean =>
    !OPAQUE_SHELL_PATTERN.test(value) &&
    commands.every((command, commandIndex) => {
      if (SHELL_STATE_MUTATING_COMMAND_PATTERN.test(command)) {
        return false;
      }

      return (
        SIMPLE_SHELL_COMMAND_PATTERN.test(command) ||
        getSimpleBlockingCommand({
          command,
          commandCount: commands.length,
          commandIndex,
        }) !== null
      );
    });

  const getManagedBlockFloor = (value: string): number | null => {
    const lines = value.split(LINE_BREAK_PATTERN);
    const beginIndexes = lines.flatMap((line, index) =>
      line.trim() === BEGIN_MARKER ? [index] : []
    );
    const endIndexes = lines.flatMap((line, index) =>
      line.trim() === END_MARKER ? [index] : []
    );

    if (beginIndexes.length === 0 && endIndexes.length === 0) {
      return null;
    }

    if (beginIndexes.length !== 1 || endIndexes.length !== 1) {
      return null;
    }

    const beginIndex = beginIndexes[0] as number;
    const endIndex = endIndexes[0] as number;
    const block = lines
      .slice(beginIndex + 1, endIndex)
      .map((line) => line.trim());

    if (
      endIndex <= beginIndex ||
      block.length !== 5 ||
      block[0] !== "_shadscan_previous_status=$?" ||
      block[1] !== 'if [ "$_shadscan_previous_status" -ne 0 ]; then' ||
      block[2] !== 'exit "$_shadscan_previous_status"' ||
      block[3] !== "fi"
    ) {
      return null;
    }

    const managedCommand = block[4];
    if (
      !(managedCommand && BLOCKING_EXIT_SUFFIX_PATTERN.test(managedCommand))
    ) {
      return null;
    }

    const directCommand = getSimpleBlockingCommand({
      command: managedCommand,
      commandCount: 1,
      commandIndex: 0,
    });
    const remainingContent = [
      ...lines.slice(0, beginIndex),
      ...lines.slice(endIndex + 1),
    ].join("\n");
    const remainingCommands = getExecutableLines(remainingContent);

    if (
      !(
        directCommand &&
        contentHasSafeContext(remainingContent, remainingCommands)
      )
    ) {
      return null;
    }

    return parseDirectFloor(directCommand, target);
  };

  const visitContent = (value: string, depth: number): number | null => {
    if (depth >= 5) {
      return null;
    }

    const hasManagedMarker =
      value.includes(BEGIN_MARKER) || value.includes(END_MARKER);

    if (hasManagedMarker) {
      return getManagedBlockFloor(value);
    }

    const commands = getExecutableLines(value);

    if (!contentHasSafeContext(value, commands)) {
      return null;
    }

    for (const [commandIndex, command] of commands.entries()) {
      const blockingCommand = getSimpleBlockingCommand({
        command,
        commandCount: commands.length,
        commandIndex,
      });

      if (!blockingCommand) {
        continue;
      }

      const directFloor = parseDirectFloor(blockingCommand, target);

      if (directFloor !== null) {
        return directFloor;
      }

      if (!target.allowScriptIndirection) {
        continue;
      }

      for (const scriptName of getInvokedScripts(blockingCommand)) {
        if (visitedScripts.has(scriptName)) {
          continue;
        }

        visitedScripts.add(scriptName);
        const script = scripts[scriptName];

        if (!script) {
          continue;
        }

        const scriptFloor = visitContent(script, depth + 1);

        if (scriptFloor !== null) {
          return scriptFloor;
        }
      }
    }

    return null;
  };

  return visitContent(content, 0);
};

const snapshotHook = async (
  hookPath: string
): Promise<PreCommitHookSnapshot> => {
  let stats: Awaited<ReturnType<typeof lstat>>;

  try {
    stats = await lstat(hookPath);
  } catch (error) {
    const missing = hasErrorCode(error, "ENOENT");
    return {
      content: null,
      executable: false,
      exists: !missing,
      kind: missing ? "missing" : "unsupported",
      mode: null,
      path: hookPath,
    };
  }

  const mode = stats.mode % 0o1000;

  if (stats.isSymbolicLink()) {
    return {
      content: null,
      executable: false,
      exists: true,
      kind: "symlink",
      mode,
      path: hookPath,
    };
  }

  if (stats.isDirectory()) {
    return {
      content: null,
      executable: false,
      exists: true,
      kind: "directory",
      mode,
      path: hookPath,
    };
  }

  if (!stats.isFile() || stats.size > MAX_HOOK_BYTES) {
    return {
      content: null,
      executable: false,
      exists: true,
      kind: "unsupported",
      mode,
      path: hookPath,
    };
  }

  let executable = process.platform === "win32";

  if (!executable) {
    try {
      await access(hookPath, constants.X_OK);
      executable = true;
    } catch {
      executable = false;
    }
  }

  try {
    return {
      content: await readFile(hookPath, "utf8"),
      executable,
      exists: true,
      kind: "regular",
      mode,
      path: hookPath,
    };
  } catch {
    return {
      content: null,
      executable: false,
      exists: true,
      kind: "unsupported",
      mode,
      path: hookPath,
    };
  }
};

const hasSafeShellShebang = (snapshot: PreCommitHookSnapshot): boolean => {
  if (snapshot.kind !== "regular" || snapshot.content === null) {
    return false;
  }

  const firstLine = snapshot.content.split(LINE_BREAK_PATTERN, 1)[0] ?? "";
  return SHELL_SHEBANG_PATTERN.test(firstLine);
};

const extractYamlSection = (content: string, sectionName: string): string => {
  const lines = content.split(LINE_BREAK_PATTERN);
  const sectionPattern = new RegExp(`^(\\s*)${sectionName}:\\s*(?:#.*)?$`, "u");
  let sectionIndent = -1;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (sectionIndent === -1) {
      const match = sectionPattern.exec(line);

      if (match) {
        sectionIndent = match[1]?.length ?? 0;
      }

      continue;
    }

    if (!line.trim() || line.trimStart().startsWith("#")) {
      sectionLines.push(line);
      continue;
    }

    const indentation = line.length - line.trimStart().length;

    if (indentation <= sectionIndent) {
      break;
    }

    sectionLines.push(line);
  }

  return sectionLines.join("\n");
};

const findYamlRunFloor = (
  content: string,
  scripts: Record<string, string>,
  target: ProtectionScanTarget
): number | null => {
  const commands = content
    .split(LINE_BREAK_PATTERN)
    .map((line) => YAML_RUN_PATTERN.exec(line)?.[1] ?? null)
    .filter((line): line is string => line !== null);

  for (const command of commands) {
    const floor = findProtectionFloor(command, scripts, target);

    if (floor !== null) {
      return floor;
    }
  }

  return null;
};

const collectExistingFiles = async (
  root: string,
  names: readonly string[]
): Promise<string[]> => {
  const paths: string[] = [];

  for (const name of names) {
    const candidatePath = path.join(root, name);

    if (await fileExists(candidatePath)) {
      paths.push(candidatePath);
    }
  }

  return paths;
};

const getSimpleGitHooksCommand = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const command = (value as JsonObject)["pre-commit"];

  return typeof command === "string" ? command : null;
};

const collectManagerConfigs = async ({
  coreHooksPath,
  gitRoot,
  projectRoot,
  rootPackage,
  scripts,
}: {
  coreHooksPath: string | null;
  gitRoot: string;
  projectRoot: string;
  rootPackage: PackageMetadata | null;
  scripts: Record<string, string>;
}): Promise<ManagerConfig[]> => {
  const configs: ManagerConfig[] = [];
  const target: ProtectionScanTarget = {
    allowScriptIndirection: projectRoot === gitRoot,
    gitRoot,
    projectRoot,
  };
  const huskyDirectory = path.join(gitRoot, ".husky");
  const huskyHookPath = path.join(huskyDirectory, "pre-commit");
  const rootDependencies = rootPackage
    ? getDependencyNames(rootPackage.object)
    : new Set<string>();
  const rootPrepareScript = rootPackage?.scripts.prepare ?? "";
  const hasHuskySignal =
    (await fileExists(huskyDirectory)) ||
    rootDependencies.has("husky") ||
    HUSKY_PREPARE_PATTERN.test(rootPrepareScript) ||
    coreHooksPath?.includes(".husky") === true;

  if (hasHuskySignal) {
    const content = await readTextFile(huskyHookPath);
    configs.push({
      content,
      manager: "husky",
      opaque: content?.includes("\0") ?? false,
      path: huskyHookPath,
      protectedFloor:
        content === null ? null : findProtectionFloor(content, scripts, target),
    });
  }

  const lefthookPaths = await collectExistingFiles(
    gitRoot,
    LEFTHOOK_CONFIG_NAMES
  );

  if (lefthookPaths.length > 0) {
    const configPath = lefthookPaths[0] as string;
    const content = await readTextFile(configPath);
    const preCommitSection = content
      ? extractYamlSection(content, "pre-commit")
      : "";
    configs.push({
      content,
      manager: "lefthook",
      opaque: lefthookPaths.length > 1 || !preCommitSection,
      path: configPath,
      protectedFloor: preCommitSection
        ? findYamlRunFloor(preCommitSection, scripts, target)
        : null,
    });
  }

  const preCommitPaths = await collectExistingFiles(
    gitRoot,
    PRE_COMMIT_CONFIG_NAMES
  );

  if (preCommitPaths.length > 0) {
    const configPath = preCommitPaths[0] as string;
    const content = await readTextFile(configPath);
    configs.push({
      content,
      manager: "pre-commit",
      opaque: preCommitPaths.length > 1 || content === null,
      path: configPath,
      protectedFloor: content
        ? findYamlRunFloor(content, scripts, target)
        : null,
    });
  }

  const simpleConfigPaths = await collectExistingFiles(
    gitRoot,
    SIMPLE_GIT_HOOKS_CONFIG_NAMES
  );
  const packageSimpleConfig = rootPackage?.object["simple-git-hooks"];

  if (simpleConfigPaths.length > 0 || packageSimpleConfig !== undefined) {
    const configPath =
      simpleConfigPaths[0] ??
      rootPackage?.path ??
      path.join(gitRoot, "package.json");
    const isJavaScriptConfig = JAVASCRIPT_CONFIG_PATTERN.test(configPath);
    let command = getSimpleGitHooksCommand(packageSimpleConfig);
    let content = rootPackage ? JSON.stringify(rootPackage.object) : null;

    if (simpleConfigPaths.length === 1 && !isJavaScriptConfig) {
      const simpleObject = await readJsonObject(configPath);
      command = getSimpleGitHooksCommand(simpleObject);
      content = await readTextFile(configPath);
    } else if (simpleConfigPaths.length > 0) {
      content = await readTextFile(configPath);
    }

    configs.push({
      content,
      manager: "simple-git-hooks",
      opaque:
        isJavaScriptConfig ||
        simpleConfigPaths.length > 1 ||
        (simpleConfigPaths.length > 0 && packageSimpleConfig !== undefined),
      path: configPath,
      protectedFloor: command
        ? findProtectionFloor(command, scripts, target)
        : null,
    });
  }

  return configs;
};

const inferWrapperManager = (
  hook: PreCommitHookSnapshot,
  effectiveHooksPath: string
): Exclude<PreCommitManager, "native"> | null => {
  const normalizedHooksPath = effectiveHooksPath.split(path.sep).join("/");
  const content = hook.content ?? "";

  if (
    normalizedHooksPath.includes("/.husky/") ||
    HUSKY_WRAPPER_PATTERN.test(content)
  ) {
    return "husky";
  }

  if (LEFTHOOK_WRAPPER_PATTERN.test(content)) {
    return "lefthook";
  }

  if (SIMPLE_GIT_HOOKS_WRAPPER_PATTERN.test(content)) {
    return "simple-git-hooks";
  }

  if (PRE_COMMIT_WRAPPER_PATTERN.test(content)) {
    return "pre-commit";
  }

  return null;
};

const resolveEffectiveHooksPath = async (
  gitRoot: string,
  runGit: GitCommandRunner
): Promise<string | null> => {
  const absoluteResult = await runGit(
    ["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
    gitRoot
  );

  if (absoluteResult.exitCode === 0) {
    const absolutePath = trimCommandOutput(absoluteResult.stdout);

    if (absolutePath) {
      return path.resolve(gitRoot, absolutePath);
    }
  }

  const fallbackResult = await runGit(
    ["rev-parse", "--git-path", "hooks"],
    gitRoot
  );

  if (fallbackResult.exitCode !== 0) {
    return null;
  }

  const fallbackPath = trimCommandOutput(fallbackResult.stdout);

  return fallbackPath ? path.resolve(gitRoot, fallbackPath) : null;
};

const detectPreCommitProtection = async (
  options: DetectPreCommitProtectionOptions
): Promise<PreCommitProtection> => {
  const projectRoot = path.resolve(options.projectRoot);
  const runGit = options.runGit ?? defaultGitCommandRunner;
  const gitRootResult = await runGit(
    ["rev-parse", "--show-toplevel"],
    projectRoot
  );

  if (gitRootResult.exitCode !== 0) {
    return {
      activeHookPath: null,
      configPaths: [],
      coreHooksPath: null,
      effectiveHooksPath: null,
      floor: null,
      gitRoot: null,
      hookSource: null,
      manager: null,
      managers: [],
      projectRoot,
      reason: "The selected project is not inside an available Git worktree.",
      status: "unavailable",
    };
  }

  const gitRoot = path.resolve(trimCommandOutput(gitRootResult.stdout));

  if (!(gitRoot && isWithin(gitRoot, projectRoot))) {
    return {
      activeHookPath: null,
      configPaths: [],
      coreHooksPath: null,
      effectiveHooksPath: null,
      floor: null,
      gitRoot: gitRoot || null,
      hookSource: null,
      manager: null,
      managers: [],
      projectRoot,
      reason: "The selected project is outside the discovered Git worktree.",
      status: "unavailable",
    };
  }

  const [effectiveHooksPath, coreHooksResult] = await Promise.all([
    resolveEffectiveHooksPath(gitRoot, runGit),
    runGit(["config", "--path", "--get", "core.hooksPath"], gitRoot),
  ]);
  const coreHooksPath =
    coreHooksResult.exitCode === 0
      ? trimCommandOutput(coreHooksResult.stdout) || null
      : null;

  if (!effectiveHooksPath) {
    return {
      activeHookPath: null,
      configPaths: [],
      coreHooksPath,
      effectiveHooksPath: null,
      floor: null,
      gitRoot,
      hookSource: null,
      manager: null,
      managers: [],
      projectRoot,
      reason: "Git did not provide an effective hooks directory.",
      status: "unavailable",
    };
  }

  const activeHookPath = path.join(effectiveHooksPath, "pre-commit");
  const [activeHook, projectPackage, rootPackage] = await Promise.all([
    snapshotHook(activeHookPath),
    readPackageMetadata(projectRoot),
    projectRoot === gitRoot
      ? readPackageMetadata(projectRoot)
      : readPackageMetadata(gitRoot),
  ]);
  const scripts = mergePackageScripts(projectPackage, rootPackage);
  const configs = await collectManagerConfigs({
    coreHooksPath,
    gitRoot,
    projectRoot,
    rootPackage,
    scripts,
  });
  const managers = new Set<PreCommitManager>(
    configs.map(({ manager }) => manager)
  );
  const wrapperManager = inferWrapperManager(activeHook, effectiveHooksPath);

  if (activeHook.exists && !wrapperManager && configs.length === 0) {
    managers.add("native");
  } else if (activeHook.exists && wrapperManager) {
    managers.add(wrapperManager);
  } else if (activeHook.exists && configs.length > 0) {
    managers.add("native");
  }

  const managerList = [...managers].sort();
  const configPaths = configs.map(({ path: configPath }) => configPath);

  if (managerList.length > 1) {
    return {
      activeHookPath,
      configPaths,
      coreHooksPath,
      effectiveHooksPath,
      floor: null,
      gitRoot,
      hookSource: activeHook,
      manager: null,
      managers: managerList,
      projectRoot,
      reason: `Multiple hook managers were detected: ${managerList.join(", ")}.`,
      status: "conflict",
    };
  }

  const manager = managerList[0] ?? null;

  if (!manager) {
    return {
      activeHookPath,
      configPaths,
      coreHooksPath,
      effectiveHooksPath,
      floor: null,
      gitRoot,
      hookSource: activeHook,
      manager: null,
      managers: [],
      projectRoot,
      reason:
        "No pre-commit hook or supported hook-manager configuration was found.",
      status: "absent",
    };
  }

  if (manager === "native") {
    const target: ProtectionScanTarget = {
      allowScriptIndirection: projectRoot === gitRoot,
      gitRoot,
      projectRoot,
    };
    const parsedFloor =
      activeHook.content === null
        ? null
        : findProtectionFloor(activeHook.content, scripts, target);
    const floor = hasSafeShellShebang(activeHook) ? parsedFloor : null;
    const protectedAndActive =
      activeHook.kind === "regular" && activeHook.executable && floor !== null;

    return {
      activeHookPath,
      configPaths,
      coreHooksPath,
      effectiveHooksPath,
      floor,
      gitRoot,
      hookSource: activeHook,
      manager,
      managers: [manager],
      projectRoot,
      reason: protectedAndActive
        ? `The active native pre-commit hook blocks Shadscan scores below ${floor}.`
        : "A native pre-commit hook exists but does not contain a verified blocking Shadscan command.",
      status: protectedAndActive ? "protected-active" : "integrable",
    };
  }

  const config = configs.find(
    ({ manager: configManager }) => configManager === manager
  );
  let sourceHook: PreCommitHookSnapshot | null = null;

  if (manager === "husky" && config) {
    sourceHook = await snapshotHook(config.path);
  } else if (config) {
    sourceHook = {
      content: config.content,
      executable: false,
      exists: config.content !== null,
      kind: config.content === null ? "missing" : "regular",
      mode: null,
      path: config.path,
    };
  }
  let reason = `The ${manager} configuration is present and requires manual dispatch validation.`;

  if (config?.opaque) {
    reason = `The ${manager} configuration is present but is too complex to update automatically.`;
  }

  return {
    activeHookPath,
    configPaths,
    coreHooksPath,
    effectiveHooksPath,
    floor: null,
    gitRoot,
    hookSource: sourceHook,
    manager,
    managers: [manager],
    projectRoot,
    reason,
    status: "integrable",
  };
};

const assertValidScore = (score: number): void => {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new PreCommitError(
      "INVALID_SCORE",
      "The pre-commit floor must be an integer between 0 and 100."
    );
  }
};

const assertExactVersion = (version: string): void => {
  if (!EXACT_VERSION_PATTERN.test(version)) {
    throw new PreCommitError(
      "INVALID_VERSION",
      "The pre-commit plan requires an exact semantic CLI version."
    );
  }
};

const quoteShellArgument = (value: string): string =>
  SAFE_SHELL_ARGUMENT_PATTERN.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;

const createAuditCommand = ({
  gitRoot,
  packageManager,
  projectRoot,
  score,
  version,
}: {
  gitRoot: string;
  packageManager: Exclude<PackageManager, "unknown">;
  projectRoot: string;
  score: number;
  version: string;
}): string => {
  const packageSpecifier = `@shadscan/cli@${version}`;
  const relativeProjectPath = path
    .relative(gitRoot, projectRoot)
    .split(path.sep)
    .join("/");
  const projectArgument = relativeProjectPath
    ? quoteShellArgument(`./${relativeProjectPath}`)
    : null;
  const commandParts: string[] = [];

  switch (packageManager) {
    case "bun":
      commandParts.push("bunx", packageSpecifier);
      break;
    case "npm":
      commandParts.push("npx", "--yes", packageSpecifier);
      break;
    case "pnpm":
      commandParts.push("pnpm", "dlx", packageSpecifier);
      break;
    case "yarn":
      commandParts.push(
        "yarn",
        "dlx",
        "--quiet",
        "--package",
        packageSpecifier,
        "shadscan"
      );
      break;
    default:
      throw new PreCommitError(
        "MANUAL_REQUIRED",
        "The package manager cannot produce a supported Shadscan command."
      );
  }

  if (projectArgument) {
    commandParts.push(projectArgument);
  }

  commandParts.push(
    "--fail-under",
    String(score),
    "--no-roast",
    "--no-interactive"
  );

  return commandParts.join(" ");
};

const getLineEnding = (content: string): "\n" | "\r\n" =>
  content.includes("\r\n") ? "\r\n" : "\n";

const renderMarkerBlock = (command: string, lineEnding: string): string =>
  [
    BEGIN_MARKER,
    "_shadscan_previous_status=$?",
    'if [ "$_shadscan_previous_status" -ne 0 ]; then',
    '  exit "$_shadscan_previous_status"',
    "fi",
    `${command} || exit $?`,
    END_MARKER,
  ].join(lineEnding);

const appendStatusPreservingMarkerBlock = (
  content: string,
  command: string
): string => {
  const lineEnding = getLineEnding(content);
  const markerBlock = renderMarkerBlock(command, lineEnding);

  if (!content) {
    return `#!/bin/sh${lineEnding}${markerBlock}${lineEnding}`;
  }

  const contentWithFinalNewline = content.endsWith("\n")
    ? content
    : `${content}${lineEnding}`;

  return `${contentWithFinalNewline}${markerBlock}${lineEnding}`;
};

const hasPartialMarker = (content: string): boolean =>
  content.includes(BEGIN_MARKER) !== content.includes(END_MARKER);

const isSafeShellHook = (
  snapshot: PreCommitHookSnapshot,
  manager: "husky" | "native"
): boolean => {
  if (snapshot.kind === "missing") {
    return true;
  }

  if (snapshot.kind !== "regular" || snapshot.content === null) {
    return false;
  }

  const content = snapshot.content;
  const executableCommands = getExecutableLines(content);

  if (
    content.includes("\0") ||
    hasPartialMarker(content) ||
    SHADSCAN_TOKEN_PATTERN.test(content) ||
    OPAQUE_SHELL_PATTERN.test(content) ||
    executableCommands.some(
      (command) => !SIMPLE_SHELL_COMMAND_PATTERN.test(command)
    ) ||
    executableCommands.some((command) =>
      SHELL_STATE_MUTATING_COMMAND_PATTERN.test(command)
    )
  ) {
    return false;
  }

  if (manager === "native") {
    if (!hasSafeShellShebang(snapshot)) {
      return false;
    }

    if (!snapshot.executable) {
      return false;
    }
  }

  return true;
};

const createManualPlan = ({
  command,
  detection,
  options,
  reason,
  steps,
}: {
  command: string | null;
  detection: PreCommitProtection;
  options: CreatePreCommitInstallPlanOptions;
  reason: string;
  steps: string[];
}): PreCommitInstallPlan => ({
  changes: [],
  command,
  detection,
  manager: detection.manager,
  manualSteps: steps,
  mode: "manual",
  packageManager: options.packageManager,
  projectRoot: path.resolve(options.projectRoot),
  reason,
  runGit: options.runGit ?? defaultGitCommandRunner,
  score: options.score,
  version: options.version,
});

const createPreCommitInstallPlan = async (
  options: CreatePreCommitInstallPlanOptions
): Promise<PreCommitInstallPlan> => {
  assertValidScore(options.score);
  assertExactVersion(options.version);
  const projectRoot = path.resolve(options.projectRoot);
  const detection =
    options.detection ?? (await detectPreCommitProtection(options));

  if (
    detection.status === "protected-active" &&
    detection.floor !== null &&
    detection.floor >= options.score
  ) {
    return {
      changes: [],
      command: null,
      detection,
      manager: detection.manager,
      manualSteps: [],
      mode: "not-needed",
      packageManager: options.packageManager,
      projectRoot,
      reason: detection.reason,
      runGit: options.runGit ?? defaultGitCommandRunner,
      score: options.score,
      version: options.version,
    };
  }

  if (!(detection.gitRoot && detection.effectiveHooksPath)) {
    return createManualPlan({
      command: null,
      detection,
      options,
      reason: detection.reason,
      steps: [
        "Run Shadscan from a Git worktree, then add a blocking command to that repository's pre-commit setup.",
      ],
    });
  }

  if (options.packageManager === "unknown") {
    return createManualPlan({
      command: null,
      detection,
      options,
      reason:
        "The package manager is unknown, so Shadscan cannot produce a reliable hook command.",
      steps: [
        `Add @shadscan/cli@${options.version} with the repository's package manager.`,
        `Run shadscan --fail-under ${options.score} --no-roast --no-interactive from pre-commit.`,
      ],
    });
  }

  const command = createAuditCommand({
    gitRoot: detection.gitRoot,
    packageManager: options.packageManager,
    projectRoot,
    score: options.score,
    version: options.version,
  });

  if (!SIMPLE_SHELL_COMMAND_PATTERN.test(command)) {
    return createManualPlan({
      command,
      detection,
      options,
      reason:
        "The selected project path requires shell quoting, so automatic hook installation is disabled.",
      steps: [
        `Add this command to the active pre-commit configuration after reviewing its quoted project path: ${command}`,
      ],
    });
  }

  if (detection.status === "conflict") {
    return createManualPlan({
      command,
      detection,
      options,
      reason: detection.reason,
      steps: [
        "Choose the repository's single source-of-truth hook manager.",
        `Add this command to its pre-commit configuration: ${command}`,
      ],
    });
  }

  if (
    detection.manager === "husky" ||
    detection.manager === "lefthook" ||
    detection.manager === "pre-commit" ||
    detection.manager === "simple-git-hooks"
  ) {
    return createManualPlan({
      command,
      detection,
      options,
      reason: `The detected ${detection.manager} configuration is preserved for manual integration.`,
      steps: [
        `Add this full-project command to the existing pre-commit configuration: ${command}`,
        "Activate or validate the existing hook manager without replacing its other commands.",
      ],
    });
  }

  const manager = "native" as const;
  const target =
    detection.hookSource ??
    (await snapshotHook(path.join(detection.effectiveHooksPath, "pre-commit")));

  if (!(target && isWithin(detection.gitRoot, target.path))) {
    return createManualPlan({
      command,
      detection,
      options,
      reason: "The effective pre-commit source is outside the Git worktree.",
      steps: [
        `Add this command to the active pre-commit hook manually: ${command}`,
      ],
    });
  }

  if (!(await isSafeWritePath(detection.gitRoot, target.path))) {
    return createManualPlan({
      command,
      detection,
      options,
      reason:
        "The effective pre-commit source resolves through an unsafe path outside the Git worktree.",
      steps: [
        `Add this command to the active pre-commit hook manually: ${command}`,
      ],
    });
  }

  if (!isSafeShellHook(target, manager)) {
    return createManualPlan({
      command,
      detection,
      options,
      reason:
        "The existing hook is opaque, non-executable, already mentions Shadscan, or contains control flow that cannot be appended safely.",
      steps: [`Add this command at a reachable point in the hook: ${command}`],
    });
  }

  const before = target.content;
  const after = appendStatusPreservingMarkerBlock(before ?? "", command);
  const mode = target.mode ?? 0o755;

  return {
    changes: [
      {
        after,
        before,
        mode,
        operation: target.exists ? "update" : "create",
        path: target.path,
      },
    ],
    command,
    detection,
    manager,
    manualSteps: [],
    mode: "automatic",
    packageManager: options.packageManager,
    projectRoot,
    reason: target.exists
      ? `Append an idempotent Shadscan block while preserving the existing ${manager} hook's final status.`
      : `Create a ${manager} pre-commit hook with an idempotent Shadscan block.`,
    runGit: options.runGit ?? defaultGitCommandRunner,
    score: options.score,
    version: options.version,
  };
};

const formatPreCommitInstallPlan = (plan: PreCommitInstallPlan): string => {
  const lines = [
    "Shadscan pre-commit plan",
    `  Mode: ${plan.mode}`,
    `  Floor: ${plan.score}/100`,
    `  CLI: @shadscan/cli@${plan.version}`,
    `  Manager: ${plan.manager ?? "none"}`,
    `  Reason: ${sanitizeTerminalText(plan.reason)}`,
  ];

  if (plan.command) {
    lines.push(`  Command: ${sanitizeTerminalText(plan.command)}`);
  }

  for (const change of plan.changes) {
    lines.push(
      `  ${change.operation === "create" ? "Create" : "Update"}: ${sanitizeTerminalText(change.path)}`
    );
  }

  if (plan.manualSteps.length > 0) {
    lines.push("  Manual steps:");
    for (const step of plan.manualSteps) {
      lines.push(`    - ${sanitizeTerminalText(step)}`);
    }
  }

  if (plan.mode === "automatic") {
    lines.push("  Existing hooks will not be executed.");
  }

  return `${lines.join("\n")}\n`;
};

const validateChangeTarget = async (
  change: PreCommitFileChange
): Promise<"already-applied" | "ready"> => {
  const current = await snapshotHook(change.path);

  if (current.kind === "regular" && current.content === change.after) {
    return "already-applied";
  }

  if (change.before === null) {
    if (current.kind !== "missing") {
      throw new PreCommitError(
        "STALE_PLAN",
        `Refusing to create ${change.path} because it appeared after the plan was built.`
      );
    }

    return "ready";
  }

  if (
    current.kind !== "regular" ||
    current.content !== change.before ||
    current.mode !== change.mode
  ) {
    throw new PreCommitError(
      "STALE_PLAN",
      `Refusing to update ${change.path} because it changed after the plan was built.`
    );
  }

  return "ready";
};

const atomicWrite = async (
  change: PreCommitFileChange,
  gitRoot: string
): Promise<void> => {
  const directory = path.dirname(change.path);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(change.path)}.shadscan-${process.pid}-${randomUUID()}.tmp`
  );

  if (!(await isSafeWritePath(gitRoot, change.path))) {
    throw new PreCommitError(
      "UNSAFE_PATH",
      `Refusing to write through an unsafe hooks path: ${change.path}`
    );
  }

  await mkdir(directory, { recursive: true });

  if (!(await isSafeWritePath(gitRoot, change.path))) {
    throw new PreCommitError(
      "UNSAFE_PATH",
      `Refusing to write through an unsafe hooks path: ${change.path}`
    );
  }
  let handle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    handle = await open(temporaryPath, "wx", change.mode);
    await handle.writeFile(change.after, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporaryPath, change.mode);
    await rename(temporaryPath, change.path);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }

    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new PreCommitError(
      "WRITE_FAILED",
      `Could not write ${change.path}: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
};

const equalStringArrays = (
  left: readonly string[],
  right: readonly string[]
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const hasSameProtectionContext = (
  planned: PreCommitProtection,
  current: PreCommitProtection
): boolean =>
  planned.activeHookPath === current.activeHookPath &&
  planned.coreHooksPath === current.coreHooksPath &&
  planned.effectiveHooksPath === current.effectiveHooksPath &&
  planned.floor === current.floor &&
  planned.gitRoot === current.gitRoot &&
  planned.manager === current.manager &&
  planned.projectRoot === current.projectRoot &&
  planned.status === current.status &&
  equalStringArrays(planned.configPaths, current.configPaths) &&
  equalStringArrays(planned.managers, current.managers);

const applyPreCommitInstallPlan = async (
  plan: PreCommitInstallPlan,
  options: ApplyPreCommitInstallPlanOptions
): Promise<ApplyPreCommitInstallPlanResult> => {
  if (!options.confirmed) {
    throw new PreCommitError(
      "CONFIRMATION_REQUIRED",
      "Explicit confirmation is required before changing a pre-commit hook."
    );
  }

  if (plan.mode !== "automatic") {
    throw new PreCommitError(
      "MANUAL_REQUIRED",
      "This pre-commit plan requires manual integration and cannot be applied automatically."
    );
  }

  if (!plan.detection.gitRoot) {
    throw new PreCommitError(
      "UNSAFE_PATH",
      "The plan has no verified Git root."
    );
  }

  for (const change of plan.changes) {
    if (!(await isSafeWritePath(plan.detection.gitRoot, change.path))) {
      throw new PreCommitError(
        "UNSAFE_PATH",
        `Refusing to write through an unsafe path outside the Git worktree: ${change.path}`
      );
    }
  }

  const validationResults = await Promise.all(
    plan.changes.map((change) => validateChangeTarget(change))
  );
  const changesToApply = plan.changes.filter(
    (_, index) => validationResults[index] === "ready"
  );

  if (changesToApply.length === 0) {
    return { alreadyApplied: true, changedPaths: [] };
  }

  const currentDetection = await detectPreCommitProtection({
    projectRoot: plan.projectRoot,
    runGit: plan.runGit,
  });

  if (!hasSameProtectionContext(plan.detection, currentDetection)) {
    throw new PreCommitError(
      "STALE_PLAN",
      "Refusing to apply the pre-commit plan because the repository's hook-manager state changed after the plan was built."
    );
  }

  await Promise.all(changesToApply.map(validateChangeTarget));

  for (const change of changesToApply) {
    await atomicWrite(change, plan.detection.gitRoot);
  }

  return {
    alreadyApplied: changesToApply.length === 0,
    changedPaths: changesToApply.map(({ path: changedPath }) => changedPath),
  };
};

export type {
  ApplyPreCommitInstallPlanOptions,
  ApplyPreCommitInstallPlanResult,
  CreatePreCommitInstallPlanOptions,
  DetectPreCommitProtectionOptions,
  GitCommandResult,
  GitCommandRunner,
  PackageManager,
  PreCommitErrorCode,
  PreCommitFileChange,
  PreCommitInstallPlan,
  PreCommitManager,
  PreCommitPlanMode,
  PreCommitProtection,
  PreCommitProtectionStatus,
};
export {
  applyPreCommitInstallPlan,
  createPreCommitInstallPlan,
  detectPreCommitProtection,
  formatPreCommitInstallPlan,
  PreCommitError,
};
