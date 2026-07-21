import path from "node:path";
import { type ParseConfigFileHost, sys } from "typescript";

interface ConfinedTypeScriptHost extends ParseConfigFileHost {
  isPathAllowed: (candidatePath: string) => boolean;
  pathExists: (candidatePath: string) => boolean;
}

const isWithinRoot = (rootDir: string, candidatePath: string): boolean => {
  const relativePath = path.relative(rootDir, candidatePath);

  return (
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};

const createConfinedTypeScriptHost = (
  filesystemRoot: string
): ConfinedTypeScriptHost => {
  const resolvedRoot = path.resolve(filesystemRoot);
  const canonicalRoot = path.resolve(
    sys.realpath?.(resolvedRoot) ?? resolvedRoot
  );
  const isPathAllowed = (candidatePath: string): boolean => {
    const resolvedCandidate = path.resolve(candidatePath);
    const isLexicallyContained =
      isWithinRoot(resolvedRoot, resolvedCandidate) ||
      isWithinRoot(canonicalRoot, resolvedCandidate);

    if (!isLexicallyContained) {
      return false;
    }

    const canonicalCandidate = path.resolve(
      sys.realpath?.(resolvedCandidate) ?? resolvedCandidate
    );
    return isWithinRoot(canonicalRoot, canonicalCandidate);
  };
  const fileExists = (filePath: string): boolean =>
    isPathAllowed(filePath) && sys.fileExists(filePath);
  const directoryExists = (directoryPath: string): boolean =>
    isPathAllowed(directoryPath) && sys.directoryExists(directoryPath);

  return {
    directoryExists,
    fileExists,
    getCurrentDirectory: () => resolvedRoot,
    getDirectories: (directoryPath) =>
      directoryExists(directoryPath)
        ? sys.getDirectories(directoryPath).filter(isPathAllowed)
        : [],
    isPathAllowed,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
    pathExists: (candidatePath) =>
      fileExists(candidatePath) || directoryExists(candidatePath),
    readDirectory: () => [],
    readFile: (filePath) =>
      isPathAllowed(filePath) ? sys.readFile(filePath) : undefined,
    realpath: (candidatePath) =>
      isPathAllowed(candidatePath)
        ? (sys.realpath?.(candidatePath) ?? path.resolve(candidatePath))
        : path.resolve(candidatePath),
    useCaseSensitiveFileNames: sys.useCaseSensitiveFileNames,
  };
};

export type { ConfinedTypeScriptHost };
export { createConfinedTypeScriptHost };
