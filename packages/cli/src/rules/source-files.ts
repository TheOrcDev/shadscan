import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";
import type { AuditContext } from "../audit";
import { compareCodeUnits } from "../deterministic-order";
import type { ProjectDiscovery } from "../discovery";
import { SCAN_SOURCE_LIMITS } from "../source-requirements";

interface SourceFile {
  content: string;
  path: string;
}

interface SafeFile {
  path: string;
  readPath: string;
  size: number;
}

interface SafeFileSearch {
  files: SafeFile[];
  skippedUnsafe: number;
  truncated: boolean;
}

const SOURCE_PATTERNS = [
  "*.{js,jsx,ts,tsx}",
  "app/**/*.{js,jsx,ts,tsx}",
  "pages/**/*.{js,jsx,ts,tsx}",
  "resources/js/**/*.{js,jsx,ts,tsx}",
  "src/**/*.{js,jsx,ts,tsx}",
  // Astro templates are read as text for document-shell and island checks;
  // the AST loader's script filter keeps them out of the TypeScript parser.
  "src/**/*.astro",
  "components/**/*.{js,jsx,ts,tsx}",
  "lib/**/*.{js,jsx,ts,tsx}",
  "hooks/**/*.{js,jsx,ts,tsx}",
  "index.html",
];
const STYLE_PATTERNS = [
  "*.css",
  "app/**/*.css",
  "components/**/*.css",
  "resources/css/**/*.css",
  "src/**/*.css",
  "styles/**/*.css",
];
const APP_NON_PAGE_SOURCE_PATTERN =
  /(?:^|[/\\])(?:src[/\\])?app[/\\](?:.*[/\\])?(?:apple-icon|icon|opengraph-image|route|twitter-image)\.[cm]?[jt]sx?$/i;
const PAGES_API_SOURCE_PATTERN =
  /(?:^|[/\\])(?:src[/\\])?pages[/\\]api[/\\].+\.[cm]?[jt]sx?$/i;
const PROJECT_IGNORES = [
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
];
const MAX_PROJECT_FILES = SCAN_SOURCE_LIMITS.maxFiles;
const MAX_SOURCE_FILE_BYTES = SCAN_SOURCE_LIMITS.maxFileBytes;
const MAX_TOTAL_SOURCE_BYTES = SCAN_SOURCE_LIMITS.maxTotalBytes;
const sourceFileCache = new WeakMap<ProjectDiscovery, Promise<SourceFile[]>>();
const styleFileCache = new WeakMap<ProjectDiscovery, Promise<SourceFile[]>>();

const appendWarning = (project: ProjectDiscovery, warning: string): void => {
  project.sourceCoverage = "partial";

  if (!project.warnings.includes(warning)) {
    project.warnings.push(warning);
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

const resolveSafeFile = async (
  rootDir: string,
  filePath: string
): Promise<SafeFile | null> => {
  try {
    const fileStats = await lstat(filePath);

    if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
      return null;
    }

    const [canonicalRoot, canonicalFile] = await Promise.all([
      realpath(rootDir),
      realpath(filePath),
    ]);

    if (!isWithinRoot(canonicalRoot, canonicalFile)) {
      return null;
    }

    const canonicalStats = await stat(canonicalFile);

    if (!canonicalStats.isFile()) {
      return null;
    }

    return {
      path: filePath,
      readPath: canonicalFile,
      size: canonicalStats.size,
    };
  } catch {
    return null;
  }
};

const findSafeFiles = async (
  rootDir: string,
  patterns: string[],
  deep?: number
): Promise<SafeFileSearch> => {
  const candidates = await glob(patterns, {
    absolute: true,
    cwd: rootDir,
    deep,
    followSymbolicLinks: false,
    ignore: PROJECT_IGNORES,
    onlyFiles: true,
  });
  const files: SafeFile[] = [];
  let skippedUnsafe = 0;

  for (const candidate of candidates.sort(compareCodeUnits)) {
    if (files.length === MAX_PROJECT_FILES) {
      return { files, skippedUnsafe, truncated: true };
    }

    const safeFile = await resolveSafeFile(rootDir, candidate);

    if (safeFile) {
      files.push(safeFile);
    } else {
      skippedUnsafe += 1;
    }
  }

  return { files, skippedUnsafe, truncated: false };
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const fileStats = await lstat(filePath);
    return fileStats.isFile() && !fileStats.isSymbolicLink();
  } catch {
    return false;
  }
};

const getTextLineNumber = (
  content: string,
  pattern: RegExp
): number | undefined => {
  pattern.lastIndex = 0;
  const match = pattern.exec(content);
  pattern.lastIndex = 0;

  if (!match || match.index < 0) {
    return;
  }

  return content.slice(0, match.index).split("\n").length;
};

const isNonPageSourcePath = (filePath: string): boolean =>
  APP_NON_PAGE_SOURCE_PATTERN.test(filePath) ||
  PAGES_API_SOURCE_PATTERN.test(filePath);

const loadSourceFiles = async (
  project: ProjectDiscovery,
  patterns: string[],
  kind: "source" | "style"
): Promise<SourceFile[]> => {
  const search = await findSafeFiles(project.rootDir, patterns);
  const sourceFiles: SourceFile[] = [];
  let skippedLarge = 0;
  let skippedForBudget = 0;
  let totalBytes = 0;

  for (const file of search.files) {
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      skippedLarge += 1;
      continue;
    }

    if (totalBytes + file.size > MAX_TOTAL_SOURCE_BYTES) {
      skippedForBudget += 1;
      continue;
    }

    sourceFiles.push({
      content: await readFile(file.readPath, "utf8"),
      path: file.path,
    });
    totalBytes += file.size;
  }

  if (search.truncated) {
    appendWarning(
      project,
      `${kind} discovery was limited to ${MAX_PROJECT_FILES} files.`
    );
  }

  if (search.skippedUnsafe > 0) {
    appendWarning(
      project,
      `Skipped ${search.skippedUnsafe} unsafe ${kind} path(s).`
    );
  }

  if (skippedLarge > 0) {
    appendWarning(
      project,
      `Skipped ${skippedLarge} ${kind} file(s) larger than 2 MiB.`
    );
  }

  if (skippedForBudget > 0) {
    appendWarning(
      project,
      `Skipped ${skippedForBudget} ${kind} file(s) after the 50 MiB read limit.`
    );
  }

  return sourceFiles;
};

const readProjectSourceFile = async (
  project: ProjectDiscovery,
  filePath: string
): Promise<SourceFile | null> => {
  const safeFile = await resolveSafeFile(project.rootDir, filePath);

  if (!safeFile) {
    return null;
  }

  if (safeFile.size > MAX_SOURCE_FILE_BYTES) {
    appendWarning(project, "Skipped a project file larger than 2 MiB.");
    return null;
  }

  return {
    content: await readFile(safeFile.readPath, "utf8"),
    path: safeFile.path,
  };
};

const getProjectSourceFiles = (
  project: ProjectDiscovery
): Promise<SourceFile[]> => {
  const cachedFiles = sourceFileCache.get(project);

  if (cachedFiles) {
    return cachedFiles;
  }

  const files = loadSourceFiles(project, SOURCE_PATTERNS, "source");
  sourceFileCache.set(project, files);
  return files;
};

const getProjectStyleFiles = (
  project: ProjectDiscovery
): Promise<SourceFile[]> => {
  const cachedFiles = styleFileCache.get(project);

  if (cachedFiles) {
    return cachedFiles;
  }

  const files = loadSourceFiles(project, STYLE_PATTERNS, "style");
  styleFileCache.set(project, files);
  return files;
};

const findSourceMatch = async (
  project: ProjectDiscovery,
  pattern: RegExp
): Promise<{ file: SourceFile; line: number } | null> => {
  const files = await getProjectSourceFiles(project);

  for (const file of files) {
    const line = getTextLineNumber(file.content, pattern);

    if (line !== undefined) {
      return { file, line };
    }
  }

  return null;
};

const findFiles = async (
  rootDir: string,
  patterns: string[],
  deep?: number
): Promise<string[]> => {
  const search = await findSafeFiles(rootDir, patterns, deep);
  return search.files.map((file) => file.path);
};

const getAppRelativePatterns = (
  context: AuditContext,
  fileName: string
): string[] => {
  const appDir = context.project.paths.appDir;

  if (!appDir) {
    return [];
  }

  const relativeAppDir = path.relative(context.project.rootDir, appDir);
  const globAppDir = relativeAppDir.split(path.sep).join("/");
  return [
    path.posix.join(globAppDir, fileName),
    path.posix.join(globAppDir, "**", fileName),
  ];
};

export type { SourceFile };
export {
  fileExists,
  findFiles,
  findSourceMatch,
  getAppRelativePatterns,
  getProjectSourceFiles,
  getProjectStyleFiles,
  getTextLineNumber,
  isNonPageSourcePath,
  readProjectSourceFile,
};
