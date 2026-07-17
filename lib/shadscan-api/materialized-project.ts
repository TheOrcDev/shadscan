import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HostedScanError } from "./errors";

const createMaterializationDirectory = (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), "shadscan-"));

const resolveProjectRoot = async (
  extractionRoot: string,
  subdirectory: string
): Promise<string> => {
  const resolvedExtractionRoot = path.resolve(extractionRoot);
  const projectRoot = path.resolve(resolvedExtractionRoot, subdirectory);
  const relativeRoot = path.relative(resolvedExtractionRoot, projectRoot);

  if (relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) {
    throw new HostedScanError(
      "The requested subdirectory is outside the source.",
      {
        code: "UNSAFE_SUBDIRECTORY",
        status: 422,
      }
    );
  }

  try {
    const [rootStats, packageStats] = await Promise.all([
      lstat(projectRoot),
      lstat(path.join(projectRoot, "package.json")),
    ]);
    if (!(rootStats.isDirectory() && packageStats.isFile())) {
      throw new Error("Expected a directory with a package.json file.");
    }
  } catch (error) {
    throw new HostedScanError(
      "The selected source root must contain a package.json file.",
      {
        cause: error,
        code: "PROJECT_ROOT_NOT_FOUND",
        status: 422,
      }
    );
  }

  return projectRoot;
};

const cleanupMaterializationDirectory = async (
  cleanupDirectory: string
): Promise<void> => {
  const resolvedTemporaryRoot = path.resolve(tmpdir());
  const resolvedCleanupDirectory = path.resolve(cleanupDirectory);
  const relativePath = path.relative(
    resolvedTemporaryRoot,
    resolvedCleanupDirectory
  );

  if (
    !path.basename(resolvedCleanupDirectory).startsWith("shadscan-") ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    relativePath.length === 0
  ) {
    throw new HostedScanError("Refused to clean an unexpected directory.", {
      code: "UNSAFE_CLEANUP_PATH",
      status: 500,
    });
  }

  await rm(resolvedCleanupDirectory, { force: true, recursive: true });
};

export {
  cleanupMaterializationDirectory,
  createMaterializationDirectory,
  resolveProjectRoot,
};
