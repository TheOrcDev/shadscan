import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SCAN_SOURCE_LIMITS } from "@shadscan/cli";
import type { ArchiveLimits } from "./archive";
import { HostedScanError } from "./errors";
import type { RetainedGitHubTreeEntry } from "./github-tree";
import { resolveContainedPath } from "./path-safety";

const MAX_SPARSE_BLOB_REQUESTS = 64;
const MAX_SPARSE_SOURCE_BYTES = 8 * 1024 * 1024;
const SPARSE_BLOB_CONCURRENCY = 4;

interface SparseSourcePlan {
  contentBytes: number;
  contentEntries: RetainedGitHubTreeEntry[];
  retainedEntries: RetainedGitHubTreeEntry[];
  useSparseAcquisition: boolean;
}

type GitHubBlobLoader = (
  entry: RetainedGitHubTreeEntry,
  signal?: AbortSignal
) => Promise<Buffer>;

const createLimitError = (
  kind: "relevant_files" | "relevant_source_bytes" | "retained_file_bytes",
  limit: number,
  observed: number,
  unit: "bytes" | "entries",
  filePath?: string
): HostedScanError =>
  new HostedScanError("The selected project exceeds a source limit.", {
    code:
      kind === "retained_file_bytes"
        ? "ARCHIVE_FILE_TOO_LARGE"
        : "ARCHIVE_EXPANDED_TOO_LARGE",
    sourceLimit: {
      kind,
      limit,
      observed,
      ...(filePath ? { path: filePath } : {}),
      unit,
    },
    status: 422,
  });

const planSparseGitHubSource = (
  retainedEntries: RetainedGitHubTreeEntry[],
  limits: ArchiveLimits
): SparseSourcePlan => {
  if (retainedEntries.length > SCAN_SOURCE_LIMITS.maxFiles) {
    throw createLimitError(
      "relevant_files",
      SCAN_SOURCE_LIMITS.maxFiles,
      retainedEntries.length,
      "entries"
    );
  }

  const contentEntries: RetainedGitHubTreeEntry[] = [];
  let contentBytes = 0;
  for (const entry of retainedEntries) {
    if (entry.retention === "presence") {
      continue;
    }
    if (entry.size === undefined) {
      throw new HostedScanError("GitHub omitted a source blob size.", {
        code: "GITHUB_INVALID_RESPONSE",
        retryable: true,
        status: 502,
      });
    }
    if (entry.size > limits.maxFileBytes) {
      throw createLimitError(
        "retained_file_bytes",
        limits.maxFileBytes,
        entry.size,
        "bytes",
        entry.path
      );
    }
    contentBytes += entry.size;
    if (contentBytes > SCAN_SOURCE_LIMITS.maxTotalBytes) {
      throw createLimitError(
        "relevant_source_bytes",
        SCAN_SOURCE_LIMITS.maxTotalBytes,
        contentBytes,
        "bytes"
      );
    }
    contentEntries.push(entry);
  }

  return {
    contentBytes,
    contentEntries,
    retainedEntries,
    useSparseAcquisition:
      contentEntries.length <= MAX_SPARSE_BLOB_REQUESTS &&
      contentBytes <= MAX_SPARSE_SOURCE_BYTES,
  };
};

const createSparseSourceDigest = (
  entries: RetainedGitHubTreeEntry[]
): string => {
  const hash = createHash("sha256");
  for (const entry of [...entries].sort((left, right) =>
    left.path.localeCompare(right.path)
  )) {
    hash.update(
      `${entry.path}\0${entry.sha}\0${entry.size ?? 0}\0${entry.retention}\n`
    );
  }
  return `sha256:${hash.digest("hex")}`;
};

const materializeSparseGitHubSource = async (
  plan: SparseSourcePlan,
  destinationRoot: string,
  loadBlob: GitHubBlobLoader,
  signal?: AbortSignal
): Promise<string> => {
  signal?.throwIfAborted();
  await mkdir(destinationRoot, { recursive: true });

  for (const entry of plan.retainedEntries) {
    if (entry.retention !== "presence") {
      continue;
    }
    const destinationPath = resolveContainedPath(destinationRoot, entry.path);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, "", { flag: "wx", mode: 0o600 });
  }

  let nextEntryIndex = 0;
  const materializeNextEntry = async (): Promise<void> => {
    while (nextEntryIndex < plan.contentEntries.length) {
      const entryIndex = nextEntryIndex;
      nextEntryIndex += 1;
      const entry = plan.contentEntries[entryIndex];
      if (!entry) {
        return;
      }
      signal?.throwIfAborted();
      const contents =
        entry.size === 0 ? Buffer.alloc(0) : await loadBlob(entry, signal);
      if (contents.byteLength !== entry.size) {
        throw new HostedScanError("GitHub returned an invalid source blob.", {
          code: "GITHUB_INVALID_RESPONSE",
          retryable: true,
          status: 502,
        });
      }
      const destinationPath = resolveContainedPath(destinationRoot, entry.path);
      await mkdir(path.dirname(destinationPath), { recursive: true });
      await writeFile(destinationPath, contents, {
        flag: "wx",
        mode: 0o600,
      });
    }
  };

  const workerCount = Math.min(
    SPARSE_BLOB_CONCURRENCY,
    plan.contentEntries.length
  );
  await Promise.all(
    Array.from({ length: workerCount }, () => materializeNextEntry())
  );
  signal?.throwIfAborted();
  return createSparseSourceDigest(plan.retainedEntries);
};

export type { GitHubBlobLoader, SparseSourcePlan };
export {
  createSparseSourceDigest,
  MAX_SPARSE_BLOB_REQUESTS,
  MAX_SPARSE_SOURCE_BYTES,
  materializeSparseGitHubSource,
  planSparseGitHubSource,
};
