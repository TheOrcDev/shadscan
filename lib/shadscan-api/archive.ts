import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { extract, type Headers } from "tar-stream";
import { HostedScanError } from "./errors";
import {
  isForbiddenArchivePath,
  normalizeArchivePath,
  resolveContainedPath,
} from "./path-safety";
import type { SourceLimitDetail } from "./source-limits";

const gunzipArchive = promisify(gunzip);

const DEFAULT_ARCHIVE_LIMITS = {
  maxCompressedBytes: 16 * 1024 * 1024,
  maxEntries: 2500,
  maxExpandedBytes: 32 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
  maxRawEntries: 10_000,
} as const;

interface ArchiveLimits {
  maxCompressedBytes: number;
  maxEntries: number;
  maxExpandedBytes: number;
  maxFileBytes: number;
  maxRawEntries: number;
}

type ArchiveEntryRetention = "content" | "ignore" | "presence";
type ArchiveEntryPolicy = (relativePath: string) => ArchiveEntryRetention;

interface ExtractArchiveOptions {
  entryPolicy?: ArchiveEntryPolicy;
  forbiddenPathBehavior: "reject" | "skip";
  limits?: Partial<ArchiveLimits>;
  signal?: AbortSignal;
  stripComponents?: number;
}

interface ExtractionState {
  directoryPaths: Set<string>;
  extractedBytes: number;
  filePaths: Set<string>;
  rawEntryCount: number;
  retainedEntryCount: number;
  seenPaths: Set<string>;
}

type ArchiveEntryPlan =
  | { kind: "directory"; destinationPath: string }
  | {
      kind: "file";
      destinationPath: string;
      fileSize: number;
      relativePath: string;
    }
  | { kind: "presence"; destinationPath: string }
  | { kind: "skip" };

const createSourceLimitDetail = (
  kind: SourceLimitDetail["kind"],
  limit: number,
  observed: number,
  unit: SourceLimitDetail["unit"],
  relativePath?: string
): SourceLimitDetail => ({
  kind,
  limit,
  observed,
  ...(relativePath ? { path: relativePath } : {}),
  unit,
});

const hasErrorCode = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && "code" in error && typeof error.code === "string";

const collectEntry = async (
  stream: NodeJS.ReadableStream,
  expectedBytes: number,
  maxFileBytes: number,
  relativePath: string,
  signal?: AbortSignal
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const rawChunk of stream) {
    signal?.throwIfAborted();
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    totalBytes += chunk.byteLength;
    if (totalBytes > maxFileBytes) {
      throw new HostedScanError("An archive file exceeds the size limit.", {
        code: "ARCHIVE_FILE_TOO_LARGE",
        sourceLimit: createSourceLimitDetail(
          "retained_file_bytes",
          maxFileBytes,
          totalBytes,
          "bytes",
          relativePath
        ),
        status: 422,
      });
    }
    chunks.push(chunk);
  }

  if (totalBytes !== expectedBytes) {
    throw new HostedScanError("The archive contains a malformed file entry.", {
      code: "MALFORMED_ARCHIVE",
      status: 422,
    });
  }

  return Buffer.concat(chunks, totalBytes);
};

const drainEntry = async (
  stream: NodeJS.ReadableStream,
  signal?: AbortSignal
): Promise<void> => {
  for await (const _chunk of stream) {
    signal?.throwIfAborted();
    // The archive is already bounded after decompression. Drain skipped entries
    // so tar-stream can continue parsing the next header.
  }
};

const trackEntryPath = (
  header: Headers,
  state: ExtractionState,
  options: Required<
    Pick<ExtractArchiveOptions, "forbiddenPathBehavior" | "stripComponents">
  > & { entryPolicy?: ArchiveEntryPolicy; limits: ArchiveLimits }
): string | null => {
  state.rawEntryCount += 1;
  if (state.rawEntryCount > options.limits.maxRawEntries) {
    throw new HostedScanError("The archive contains too many entries.", {
      code: "ARCHIVE_TOO_MANY_ENTRIES",
      sourceLimit: createSourceLimitDetail(
        "archive_entries",
        options.limits.maxRawEntries,
        state.rawEntryCount,
        "entries"
      ),
      status: 422,
    });
  }

  const relativePath = normalizeArchivePath(header.name, {
    stripComponents: options.stripComponents,
  });
  if (relativePath === null) {
    return null;
  }

  if (state.seenPaths.has(relativePath)) {
    throw new HostedScanError("The archive contains duplicate paths.", {
      code: "ARCHIVE_DUPLICATE_PATH",
      status: 422,
    });
  }
  state.seenPaths.add(relativePath);
  return relativePath;
};

const trackRetainedEntry = (
  state: ExtractionState,
  limits: ArchiveLimits
): void => {
  state.retainedEntryCount += 1;
  if (state.retainedEntryCount > limits.maxEntries) {
    throw new HostedScanError(
      "The archive contains too many retained entries.",
      {
        code: "ARCHIVE_TOO_MANY_ENTRIES",
        sourceLimit: createSourceLimitDetail(
          "archive_entries",
          limits.maxEntries,
          state.retainedEntryCount,
          "entries"
        ),
        status: 422,
      }
    );
  }
};

const throwArchivePathConflict = (): never => {
  throw new HostedScanError("The archive contains conflicting paths.", {
    code: "ARCHIVE_PATH_CONFLICT",
    status: 422,
  });
};

const trackArchivePathShape = (
  relativePath: string,
  entryKind: "directory" | "file",
  state: ExtractionState
): void => {
  const segments = relativePath.split("/");
  let ancestorPath = "";

  for (const segment of segments.slice(0, -1)) {
    ancestorPath = ancestorPath ? `${ancestorPath}/${segment}` : segment;
    if (state.filePaths.has(ancestorPath)) {
      throwArchivePathConflict();
    }
    state.directoryPaths.add(ancestorPath);
  }

  if (entryKind === "directory") {
    if (state.filePaths.has(relativePath)) {
      throwArchivePathConflict();
    }
    state.directoryPaths.add(relativePath);
    return;
  }

  if (state.directoryPaths.has(relativePath)) {
    throwArchivePathConflict();
  }
  state.filePaths.add(relativePath);
};

const planFileEntry = (
  header: Headers,
  destinationPath: string,
  relativePath: string,
  state: ExtractionState,
  limits: ArchiveLimits
): ArchiveEntryPlan => {
  const fileSize = header.size ?? 0;
  if (fileSize < 0 || fileSize > limits.maxFileBytes) {
    throw new HostedScanError("An archive file exceeds the size limit.", {
      code: "ARCHIVE_FILE_TOO_LARGE",
      sourceLimit: createSourceLimitDetail(
        "retained_file_bytes",
        limits.maxFileBytes,
        Math.max(fileSize, 0),
        "bytes",
        relativePath
      ),
      status: 422,
    });
  }

  state.extractedBytes += fileSize;
  if (state.extractedBytes > limits.maxExpandedBytes) {
    throw new HostedScanError("The archive exceeds the expanded size limit.", {
      code: "ARCHIVE_EXPANDED_TOO_LARGE",
      sourceLimit: createSourceLimitDetail(
        "expanded_bytes",
        limits.maxExpandedBytes,
        state.extractedBytes,
        "bytes"
      ),
      status: 422,
    });
  }

  return { destinationPath, fileSize, kind: "file", relativePath };
};

const planArchiveEntry = (
  header: Headers,
  destinationRoot: string,
  state: ExtractionState,
  options: Required<
    Pick<ExtractArchiveOptions, "forbiddenPathBehavior" | "stripComponents">
  > & { entryPolicy?: ArchiveEntryPolicy; limits: ArchiveLimits }
): ArchiveEntryPlan => {
  const relativePath = trackEntryPath(header, state, options);
  if (relativePath === null) {
    return { kind: "skip" };
  }

  if (isForbiddenArchivePath(relativePath)) {
    if (options.forbiddenPathBehavior === "reject") {
      throw new HostedScanError(
        "The snapshot contains a secret or generated path that must be excluded.",
        {
          code: "FORBIDDEN_SNAPSHOT_PATH",
          status: 422,
        }
      );
    }

    return { kind: "skip" };
  }

  const destinationPath = resolveContainedPath(destinationRoot, relativePath);
  const entryType = header.type ?? "file";
  if (entryType === "directory") {
    trackArchivePathShape(relativePath, "directory", state);
    if (!options.entryPolicy) {
      trackRetainedEntry(state, options.limits);
    }
    return { destinationPath, kind: "directory" };
  }

  if (entryType !== "file" && entryType !== "contiguous-file") {
    throw new HostedScanError(
      "The archive contains a link or unsupported special file.",
      {
        code: "UNSUPPORTED_ARCHIVE_ENTRY",
        status: 422,
      }
    );
  }

  trackArchivePathShape(relativePath, "file", state);
  const retention = options.entryPolicy?.(relativePath) ?? "content";
  if (retention === "ignore") {
    return { kind: "skip" };
  }

  trackRetainedEntry(state, options.limits);
  if (retention === "presence") {
    return { destinationPath, kind: "presence" };
  }

  return planFileEntry(
    header,
    destinationPath,
    relativePath,
    state,
    options.limits
  );
};

const applyArchiveEntryPlan = async (
  plan: ArchiveEntryPlan,
  stream: NodeJS.ReadableStream,
  limits: ArchiveLimits,
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted();
  if (plan.kind === "skip") {
    await drainEntry(stream, signal);
    return;
  }

  if (plan.kind === "directory") {
    await drainEntry(stream, signal);
    signal?.throwIfAborted();
    await mkdir(plan.destinationPath, { recursive: true });
    return;
  }

  if (plan.kind === "presence") {
    await drainEntry(stream, signal);
    signal?.throwIfAborted();
    await mkdir(path.dirname(plan.destinationPath), { recursive: true });
    await writeFile(plan.destinationPath, "", { flag: "wx", mode: 0o600 });
    return;
  }

  const contents = await collectEntry(
    stream,
    plan.fileSize,
    limits.maxFileBytes,
    plan.relativePath,
    signal
  );
  signal?.throwIfAborted();
  await mkdir(path.dirname(plan.destinationPath), { recursive: true });
  await writeFile(plan.destinationPath, contents, { flag: "wx", mode: 0o600 });
};

const extractTarBuffer = async (
  tarBuffer: Buffer,
  destinationRoot: string,
  options: Required<
    Pick<ExtractArchiveOptions, "forbiddenPathBehavior" | "stripComponents">
  > & {
    entryPolicy?: ArchiveEntryPolicy;
    limits: ArchiveLimits;
    signal?: AbortSignal;
  }
): Promise<void> => {
  const archive = extract();
  let entryFailure: unknown;
  const state: ExtractionState = {
    directoryPaths: new Set<string>(),
    extractedBytes: 0,
    filePaths: new Set<string>(),
    rawEntryCount: 0,
    retainedEntryCount: 0,
    seenPaths: new Set<string>(),
  };

  const completion = new Promise<void>((resolve, reject) => {
    archive.once("finish", resolve);
    archive.once("error", reject);
  });
  const abortExtraction = (): void => {
    const reason = options.signal?.reason;
    archive.destroy(reason instanceof Error ? reason : new Error("Aborted"));
  };
  options.signal?.throwIfAborted();
  options.signal?.addEventListener("abort", abortExtraction, { once: true });

  archive.on(
    "entry",
    (header: Headers, stream: NodeJS.ReadableStream, next: () => void) => {
      const handleEntry = async (): Promise<void> => {
        options.signal?.throwIfAborted();
        const plan = planArchiveEntry(header, destinationRoot, state, options);
        await applyArchiveEntryPlan(
          plan,
          stream,
          options.limits,
          options.signal
        );
      };

      handleEntry()
        .then(next)
        .catch((error: unknown) => {
          entryFailure = error;
          archive.destroy(
            error instanceof Error ? error : new Error(String(error))
          );
        });
    }
  );

  archive.end(tarBuffer);
  try {
    await completion;
  } catch (error) {
    options.signal?.throwIfAborted();
    if (entryFailure !== undefined) {
      throw entryFailure;
    }

    throw new HostedScanError(
      "The request body is not a valid gzip tar archive.",
      {
        cause: error,
        code: "MALFORMED_ARCHIVE",
        status: 422,
      }
    );
  } finally {
    options.signal?.removeEventListener("abort", abortExtraction);
  }
};

const extractTarGzip = async (
  archiveBuffer: Buffer,
  destinationRoot: string,
  options: ExtractArchiveOptions
): Promise<void> => {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.limits };
  options.signal?.throwIfAborted();
  if (archiveBuffer.byteLength > limits.maxCompressedBytes) {
    throw new HostedScanError(
      "The archive exceeds the compressed size limit.",
      {
        code: "ARCHIVE_COMPRESSED_TOO_LARGE",
        sourceLimit: createSourceLimitDetail(
          "compressed_bytes",
          limits.maxCompressedBytes,
          archiveBuffer.byteLength,
          "bytes"
        ),
        status: 413,
      }
    );
  }

  let tarBuffer: Buffer;
  try {
    tarBuffer = await gunzipArchive(archiveBuffer, {
      maxOutputLength: limits.maxExpandedBytes,
    });
  } catch (error) {
    if (hasErrorCode(error) && error.code === "ERR_BUFFER_TOO_LARGE") {
      throw new HostedScanError(
        "The archive exceeds the expanded size limit.",
        {
          cause: error,
          code: "ARCHIVE_EXPANDED_TOO_LARGE",
          sourceLimit: createSourceLimitDetail(
            "expanded_bytes",
            limits.maxExpandedBytes,
            limits.maxExpandedBytes + 1,
            "bytes"
          ),
          status: 422,
        }
      );
    }

    throw new HostedScanError(
      "The request body is not a valid gzip tar archive.",
      {
        cause: error,
        code: "MALFORMED_ARCHIVE",
        status: 422,
      }
    );
  }

  options.signal?.throwIfAborted();
  if (tarBuffer.byteLength > limits.maxExpandedBytes) {
    throw new HostedScanError("The archive exceeds the expanded size limit.", {
      code: "ARCHIVE_EXPANDED_TOO_LARGE",
      sourceLimit: createSourceLimitDetail(
        "expanded_bytes",
        limits.maxExpandedBytes,
        tarBuffer.byteLength,
        "bytes"
      ),
      status: 422,
    });
  }

  options.signal?.throwIfAborted();
  await mkdir(destinationRoot, { recursive: true });
  await extractTarBuffer(tarBuffer, destinationRoot, {
    entryPolicy: options.entryPolicy,
    forbiddenPathBehavior: options.forbiddenPathBehavior,
    limits,
    signal: options.signal,
    stripComponents: options.stripComponents ?? 0,
  });
};

export type {
  ArchiveEntryPolicy,
  ArchiveEntryRetention,
  ArchiveLimits,
  ExtractArchiveOptions,
};
export { DEFAULT_ARCHIVE_LIMITS, extractTarGzip };
