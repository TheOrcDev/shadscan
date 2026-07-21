import path from "node:path";
import { classifyScanInputPath, type ScanInputRetention } from "@shadscan/cli";
import { z } from "zod";
import { HostedScanError } from "./errors";
import { normalizeArchivePath } from "./path-safety";

const GIT_OBJECT_SHA_PATTERN = /^[a-f0-9]{40}$/;
const NORMAL_BLOB_MODES = new Set(["100644", "100755"]);
const PROJECT_SIGNAL_PATTERN =
  /(?:^|\/)(?:(?:src\/)?(?:app|pages)\/.*\.[cm]?[jt]sx?|src\/.*\.[jt]sx|components\.json|next\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s)$/i;
const ANCESTOR_METADATA_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "components.json",
  "package-lock.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "tsconfig.base.json",
  "turbo.json",
  "yarn.lock",
]);
const MAX_PROJECT_CANDIDATES = 50;

const GitHubTreeEntrySchema = z.object({
  mode: z.string(),
  path: z.string().min(1).max(4096),
  sha: z.string().regex(GIT_OBJECT_SHA_PATTERN),
  size: z.number().int().nonnegative().optional(),
  type: z.enum(["blob", "tree", "commit"]),
  url: z.string().url().optional(),
});

const GitHubTreeResponseSchema = z.object({
  sha: z.string().regex(GIT_OBJECT_SHA_PATTERN),
  tree: z.array(GitHubTreeEntrySchema),
  truncated: z.boolean(),
  url: z.string().url().optional(),
});

type GitHubTreeEntry = z.infer<typeof GitHubTreeEntrySchema>;
type GitHubTreeResponse = z.infer<typeof GitHubTreeResponseSchema>;

interface GitHubProjectCandidate {
  label: string;
  path: string;
}

interface RetainedGitHubTreeEntry extends GitHubTreeEntry {
  retention: Exclude<ScanInputRetention, "ignore">;
}

const getParentPath = (filePath: string): string => {
  const parent = path.posix.dirname(filePath);
  return parent === "." ? "." : parent;
};

const normalizeGitHubTreeEntries = (
  entries: GitHubTreeEntry[]
): GitHubTreeEntry[] => {
  const seenPaths = new Set<string>();
  const normalizedEntries: GitHubTreeEntry[] = [];

  for (const entry of entries) {
    const normalizedPath = normalizeArchivePath(entry.path, {
      stripComponents: 0,
    });
    if (normalizedPath === null || normalizedPath !== entry.path) {
      throw new HostedScanError("GitHub returned an unsafe tree path.", {
        code: "UNSAFE_ARCHIVE_PATH",
        status: 422,
      });
    }
    if (seenPaths.has(normalizedPath)) {
      throw new HostedScanError("GitHub returned duplicate tree paths.", {
        code: "ARCHIVE_DUPLICATE_PATH",
        status: 422,
      });
    }
    seenPaths.add(normalizedPath);
    normalizedEntries.push({ ...entry, path: normalizedPath });
  }

  return normalizedEntries.sort((left, right) =>
    left.path.localeCompare(right.path)
  );
};

const findOwningPackageRoot = (
  filePath: string,
  packageRoots: Set<string>
): string | undefined => {
  let candidate = getParentPath(filePath);
  while (true) {
    if (packageRoots.has(candidate)) {
      return candidate;
    }
    if (candidate === ".") {
      return;
    }
    candidate = getParentPath(candidate);
  }
};

const discoverGitHubProjectCandidates = (
  entries: GitHubTreeEntry[]
): GitHubProjectCandidate[] => {
  const packageRoots = new Set<string>();
  for (const entry of entries) {
    if (
      entry.type === "blob" &&
      NORMAL_BLOB_MODES.has(entry.mode) &&
      path.posix.basename(entry.path) === "package.json"
    ) {
      packageRoots.add(getParentPath(entry.path));
    }
  }

  const rootsWithProjectSignals = new Set<string>();
  for (const entry of entries) {
    if (
      entry.type !== "blob" ||
      !NORMAL_BLOB_MODES.has(entry.mode) ||
      !PROJECT_SIGNAL_PATTERN.test(entry.path)
    ) {
      continue;
    }
    const packageRoot = findOwningPackageRoot(entry.path, packageRoots);
    if (packageRoot) {
      rootsWithProjectSignals.add(packageRoot);
    }
  }

  const candidates = [...rootsWithProjectSignals]
    .sort((left, right) => {
      if (left === ".") {
        return -1;
      }
      if (right === ".") {
        return 1;
      }
      return left.localeCompare(right);
    })
    .map((projectPath) => ({
      label: projectPath === "." ? "Repository root" : projectPath,
      path: projectPath,
    }));

  if (candidates.length > MAX_PROJECT_CANDIDATES) {
    throw new HostedScanError(
      "The repository contains too many project candidates for web selection.",
      {
        code: "PROJECT_SELECTION_TOO_LARGE",
        status: 422,
      }
    );
  }
  return candidates;
};

const isWithinProject = (filePath: string, projectPath: string): boolean =>
  projectPath === "." || filePath.startsWith(`${projectPath}/`);

const getAncestorDirectories = (projectPath: string): string[] => {
  if (projectPath === ".") {
    return ["."];
  }

  const segments = projectPath.split("/");
  const ancestors = ["."];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join("/"));
  }
  return ancestors;
};

const isAncestorMetadataPath = (
  filePath: string,
  projectPath: string
): boolean => {
  const parentPath = getParentPath(filePath);
  return (
    getAncestorDirectories(projectPath).includes(parentPath) &&
    ANCESTOR_METADATA_FILES.has(path.posix.basename(filePath))
  );
};

const classifyGitHubProjectPath = (
  filePath: string,
  projectPath: string
): ScanInputRetention => {
  if (isWithinProject(filePath, projectPath)) {
    return classifyScanInputPath(filePath);
  }
  return isAncestorMetadataPath(filePath, projectPath) ? "content" : "ignore";
};

const getRetainedGitHubTreeEntries = (
  entries: GitHubTreeEntry[],
  projectPath: string
): RetainedGitHubTreeEntry[] => {
  const retainedEntries: RetainedGitHubTreeEntry[] = [];
  for (const entry of entries) {
    const retention = classifyGitHubProjectPath(entry.path, projectPath);
    if (retention === "ignore" || entry.type === "tree") {
      continue;
    }
    if (entry.type !== "blob" || !NORMAL_BLOB_MODES.has(entry.mode)) {
      throw new HostedScanError(
        "The selected project contains a link or submodule.",
        {
          code: "UNSUPPORTED_ARCHIVE_ENTRY",
          status: 422,
        }
      );
    }
    retainedEntries.push({ ...entry, retention });
  }
  return retainedEntries;
};

export type {
  GitHubProjectCandidate,
  GitHubTreeEntry,
  GitHubTreeResponse,
  RetainedGitHubTreeEntry,
};
export {
  classifyGitHubProjectPath,
  discoverGitHubProjectCandidates,
  GitHubTreeEntrySchema,
  GitHubTreeResponseSchema,
  getRetainedGitHubTreeEntries,
  MAX_PROJECT_CANDIDATES,
  normalizeGitHubTreeEntries,
};
