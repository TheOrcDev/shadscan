import path from "node:path";
import { HostedScanError } from "./errors";

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const TRAILING_SLASH_PATTERN = /\/+$/;
const FORBIDDEN_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const SECRET_FILE_NAMES = new Set([
  ".npmrc",
  ".pypirc",
  "credentials",
  "id_dsa",
  "id_ed25519",
  "id_ecdsa",
  "id_rsa",
]);
const SECRET_FILE_EXTENSIONS = new Set([".key", ".p12", ".pem", ".pfx"]);

interface SafeArchivePathOptions {
  stripComponents: number;
}

const normalizeArchivePath = (
  archivePath: string,
  options: SafeArchivePathOptions
): string | null => {
  if (
    archivePath.length === 0 ||
    archivePath.length > 1024 ||
    archivePath.includes("\0") ||
    archivePath.includes("\\") ||
    archivePath.startsWith("/") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(archivePath)
  ) {
    throw new HostedScanError("The archive contains an unsafe path.", {
      code: "UNSAFE_ARCHIVE_PATH",
      status: 422,
    });
  }

  const withoutTrailingSlash = archivePath.replace(TRAILING_SLASH_PATTERN, "");
  const segments = withoutTrailingSlash.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new HostedScanError("The archive contains an unsafe path.", {
      code: "UNSAFE_ARCHIVE_PATH",
      status: 422,
    });
  }

  const strippedSegments = segments.slice(options.stripComponents);
  if (strippedSegments.length === 0) {
    return null;
  }

  if (strippedSegments.length > 16) {
    throw new HostedScanError("The archive path depth exceeds the limit.", {
      code: "ARCHIVE_PATH_TOO_DEEP",
      status: 422,
    });
  }

  const relativePath = strippedSegments.join("/");
  if (relativePath.length > 512) {
    throw new HostedScanError("The archive contains a path that is too long.", {
      code: "ARCHIVE_PATH_TOO_LONG",
      status: 422,
    });
  }

  return relativePath;
};

const isForbiddenArchivePath = (relativePath: string): boolean => {
  const segments = relativePath.toLowerCase().split("/");
  if (segments.some((segment) => FORBIDDEN_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  const fileName = segments.at(-1) ?? "";
  return (
    fileName === ".env" ||
    fileName.startsWith(".env.") ||
    SECRET_FILE_NAMES.has(fileName) ||
    SECRET_FILE_EXTENSIONS.has(path.posix.extname(fileName))
  );
};

const resolveContainedPath = (
  destinationRoot: string,
  relativePath: string
): string => {
  const resolvedRoot = path.resolve(destinationRoot);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relativeToRoot = path.relative(resolvedRoot, resolvedPath);

  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot) ||
    relativeToRoot.length === 0
  ) {
    throw new HostedScanError("The archive contains an unsafe path.", {
      code: "UNSAFE_ARCHIVE_PATH",
      status: 422,
    });
  }

  return resolvedPath;
};

export { isForbiddenArchivePath, normalizeArchivePath, resolveContainedPath };
