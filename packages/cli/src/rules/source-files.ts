import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";
import type { AuditContext } from "../audit";
import type { ProjectDiscovery } from "../discovery";

interface SourceFile {
  content: string;
  path: string;
}

const SOURCE_PATTERNS = [
  "app/**/*.{js,jsx,ts,tsx}",
  "src/**/*.{js,jsx,ts,tsx}",
  "components/**/*.{js,jsx,ts,tsx}",
  "lib/**/*.{js,jsx,ts,tsx}",
  "hooks/**/*.{js,jsx,ts,tsx}",
  "index.html",
];

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
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

const readSourceFile = async (filePath: string): Promise<SourceFile> => ({
  content: await readFile(filePath, "utf8"),
  path: filePath,
});

const getProjectSourceFiles = async (
  project: ProjectDiscovery
): Promise<SourceFile[]> => {
  const filePaths = await glob(SOURCE_PATTERNS, {
    absolute: true,
    cwd: project.rootDir,
    deep: 8,
    ignore: ["**/.next/**", "**/dist/**", "**/node_modules/**"],
  });
  const sourceFiles: SourceFile[] = [];

  for (const filePath of filePaths) {
    sourceFiles.push(await readSourceFile(filePath));
  }

  return sourceFiles;
};

const getProjectStyleFiles = async (
  project: ProjectDiscovery
): Promise<SourceFile[]> => {
  const filePaths = await findFiles(project.rootDir, ["**/*.css"]);
  const styleFiles: SourceFile[] = [];

  for (const filePath of filePaths) {
    styleFiles.push(await readSourceFile(filePath));
  }

  return styleFiles;
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
  deep = 8
): Promise<string[]> =>
  glob(patterns, {
    absolute: true,
    cwd: rootDir,
    deep,
    ignore: ["**/.next/**", "**/dist/**", "**/node_modules/**"],
  });

const getAppRelativePatterns = (
  context: AuditContext,
  fileName: string
): string[] => {
  const appDir = context.project.paths.appDir;

  if (!appDir) {
    return [];
  }

  const relativeAppDir = path.relative(context.project.rootDir, appDir);
  return [
    path.join(relativeAppDir, fileName),
    path.join(relativeAppDir, "**", fileName),
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
  readSourceFile,
};
