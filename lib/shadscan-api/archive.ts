import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGunzip, gunzip } from "node:zlib";
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

interface ExtractArchiveStreamOptions extends ExtractArchiveOptions {
  compressedSize?: number;
}

interface StreamedArchiveResult {
  compressedBytes: number;
  expandedBytes: number;
  sourceDigest: string;
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

type TarExtractionOptions = Required<
  Pick<ExtractArchiveOptions, "forbiddenPathBehavior" | "stripComponents">
> & {
  entryPolicy?: ArchiveEntryPolicy;
  limits: ArchiveLimits;
  signal?: AbortSignal;
};

interface TarExtractorContext {
  archive: ReturnType<typeof extract>;
  getEntryFailure: () => unknown;
}

const createTarExtractor = (
  destinationRoot: string,
  options: TarExtractionOptions
): TarExtractorContext => {
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

  return { archive, getEntryFailure: () => entryFailure };
};

const rethrowTarPipelineError = (
  error: unknown,
  entryFailure: unknown,
  signal?: AbortSignal
): never => {
  signal?.throwIfAborted();
  let pipelineCause = error;
  if (entryFailure !== undefined) {
    if (entryFailure instanceof HostedScanError) {
      throw entryFailure;
    }
    pipelineCause = entryFailure;
  }
  if (pipelineCause instanceof HostedScanError) {
    throw pipelineCause;
  }

  throw new HostedScanError(
    "The request body is not a valid gzip tar archive.",
    {
      cause: pipelineCause,
      code: "MALFORMED_ARCHIVE",
      status: 422,
    }
  );
};

const extractTarBuffer = async (
  tarBuffer: Buffer,
  destinationRoot: string,
  options: TarExtractionOptions
): Promise<void> => {
  const { archive, getEntryFailure } = createTarExtractor(
    destinationRoot,
    options
  );

  try {
    await pipeline(Readable.from([tarBuffer]), archive, {
      signal: options.signal,
    });
  } catch (error) {
    rethrowTarPipelineError(error, getEntryFailure(), options.signal);
  }
};

const createArchiveLimitError = (
  kind: "compressed_bytes" | "expanded_bytes",
  limit: number,
  observed: number
): HostedScanError => {
  const compressed = kind === "compressed_bytes";
  return new HostedScanError(
    compressed
      ? "The archive exceeds the compressed size limit."
      : "The archive exceeds the expanded size limit.",
    {
      code: compressed
        ? "ARCHIVE_COMPRESSED_TOO_LARGE"
        : "ARCHIVE_EXPANDED_TOO_LARGE",
      sourceLimit: createSourceLimitDetail(kind, limit, observed, "bytes"),
      status: compressed ? 413 : 422,
    }
  );
};

interface WebStreamAdapter {
  cancel: (reason?: unknown) => Promise<void>;
  iterable: AsyncGenerator<Uint8Array>;
}

const createWebStreamAdapter = (
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): WebStreamAdapter => {
  const reader = stream.getReader();
  let completed = false;
  let cancelPromise: Promise<void> | undefined;
  const cancel = (reason?: unknown): Promise<void> => {
    if (completed) {
      return Promise.resolve();
    }
    cancelPromise ??= reader.cancel(reason).catch(() => undefined);
    return cancelPromise;
  };
  const cancelOnAbort = (): void => {
    cancel(signal?.reason).catch(() => undefined);
  };

  signal?.throwIfAborted();
  signal?.addEventListener("abort", cancelOnAbort, { once: true });
  const iterable = (async function* (): AsyncGenerator<Uint8Array> {
    try {
      while (true) {
        signal?.throwIfAborted();
        const result = await reader.read();
        signal?.throwIfAborted();
        if (result.done) {
          completed = true;
          return;
        }
        yield result.value;
      }
    } finally {
      signal?.removeEventListener("abort", cancelOnAbort);
      if (!completed) {
        await cancel();
      }
      reader.releaseLock();
    }
  })();

  return { cancel, iterable };
};

const extractTarGzipStream = async (
  archiveStream: ReadableStream<Uint8Array>,
  destinationRoot: string,
  options: ExtractArchiveStreamOptions
): Promise<StreamedArchiveResult> => {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.limits };
  if (
    options.compressedSize !== undefined &&
    options.compressedSize > limits.maxCompressedBytes
  ) {
    throw createArchiveLimitError(
      "compressed_bytes",
      limits.maxCompressedBytes,
      options.compressedSize
    );
  }

  let compressedBytes = 0;
  let expandedBytes = 0;
  const sourceHash = createHash("sha256");
  const compressedCounter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      compressedBytes += bytes.byteLength;
      if (compressedBytes > limits.maxCompressedBytes) {
        callback(
          createArchiveLimitError(
            "compressed_bytes",
            limits.maxCompressedBytes,
            compressedBytes
          )
        );
        return;
      }
      sourceHash.update(bytes);
      callback(null, bytes);
    },
  });
  const expandedCounter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      expandedBytes += bytes.byteLength;
      if (expandedBytes > limits.maxExpandedBytes) {
        callback(
          createArchiveLimitError(
            "expanded_bytes",
            limits.maxExpandedBytes,
            expandedBytes
          )
        );
        return;
      }
      callback(null, bytes);
    },
  });

  options.signal?.throwIfAborted();
  await mkdir(destinationRoot, { recursive: true });
  const extractionOptions: TarExtractionOptions = {
    entryPolicy: options.entryPolicy,
    forbiddenPathBehavior: options.forbiddenPathBehavior,
    limits,
    signal: options.signal,
    stripComponents: options.stripComponents ?? 0,
  };
  const { archive, getEntryFailure } = createTarExtractor(
    destinationRoot,
    extractionOptions
  );
  const streamAdapter = createWebStreamAdapter(archiveStream, options.signal);

  try {
    await pipeline(
      Readable.from(streamAdapter.iterable),
      compressedCounter,
      createGunzip(),
      expandedCounter,
      archive,
      { signal: options.signal }
    );
  } catch (error) {
    await streamAdapter.cancel(options.signal?.reason);
    rethrowTarPipelineError(error, getEntryFailure(), options.signal);
  }

  return {
    compressedBytes,
    expandedBytes,
    sourceDigest: `sha256:${sourceHash.digest("hex")}`,
  };
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
  ExtractArchiveStreamOptions,
  StreamedArchiveResult,
};
export { DEFAULT_ARCHIVE_LIMITS, extractTarGzip, extractTarGzipStream };
