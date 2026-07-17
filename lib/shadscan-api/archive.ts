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

const gunzipArchive = promisify(gunzip);

const DEFAULT_ARCHIVE_LIMITS = {
  maxCompressedBytes: 16 * 1024 * 1024,
  maxEntries: 2500,
  maxExpandedBytes: 32 * 1024 * 1024,
  maxFileBytes: 2 * 1024 * 1024,
} as const;

interface ArchiveLimits {
  maxCompressedBytes: number;
  maxEntries: number;
  maxExpandedBytes: number;
  maxFileBytes: number;
}

interface ExtractArchiveOptions {
  forbiddenPathBehavior: "reject" | "skip";
  limits?: Partial<ArchiveLimits>;
  stripComponents?: number;
}

interface ExtractionState {
  entryCount: number;
  extractedBytes: number;
  seenPaths: Set<string>;
}

type ArchiveEntryPlan =
  | { kind: "directory"; destinationPath: string }
  | { kind: "file"; destinationPath: string; fileSize: number }
  | { kind: "skip" };

const hasErrorCode = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && "code" in error && typeof error.code === "string";

const collectEntry = async (
  stream: NodeJS.ReadableStream,
  expectedBytes: number,
  maxFileBytes: number
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const rawChunk of stream) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    totalBytes += chunk.byteLength;
    if (totalBytes > maxFileBytes) {
      throw new HostedScanError("An archive file exceeds the size limit.", {
        code: "ARCHIVE_FILE_TOO_LARGE",
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

const drainEntry = async (stream: NodeJS.ReadableStream): Promise<void> => {
  for await (const _chunk of stream) {
    // The archive is already bounded after decompression. Drain skipped entries
    // so tar-stream can continue parsing the next header.
  }
};

const trackEntryPath = (
  header: Headers,
  state: ExtractionState,
  options: Required<
    Pick<ExtractArchiveOptions, "forbiddenPathBehavior" | "stripComponents">
  > & { limits: ArchiveLimits }
): string | null => {
  state.entryCount += 1;
  if (state.entryCount > options.limits.maxEntries) {
    throw new HostedScanError("The archive contains too many entries.", {
      code: "ARCHIVE_TOO_MANY_ENTRIES",
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

const planFileEntry = (
  header: Headers,
  destinationPath: string,
  state: ExtractionState,
  limits: ArchiveLimits
): ArchiveEntryPlan => {
  const fileSize = header.size ?? 0;
  if (fileSize < 0 || fileSize > limits.maxFileBytes) {
    throw new HostedScanError("An archive file exceeds the size limit.", {
      code: "ARCHIVE_FILE_TOO_LARGE",
      status: 422,
    });
  }

  state.extractedBytes += fileSize;
  if (state.extractedBytes > limits.maxExpandedBytes) {
    throw new HostedScanError("The archive exceeds the expanded size limit.", {
      code: "ARCHIVE_EXPANDED_TOO_LARGE",
      status: 422,
    });
  }

  return { destinationPath, fileSize, kind: "file" };
};

const planArchiveEntry = (
  header: Headers,
  destinationRoot: string,
  state: ExtractionState,
  options: Required<
    Pick<ExtractArchiveOptions, "forbiddenPathBehavior" | "stripComponents">
  > & { limits: ArchiveLimits }
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

  return planFileEntry(header, destinationPath, state, options.limits);
};

const applyArchiveEntryPlan = async (
  plan: ArchiveEntryPlan,
  stream: NodeJS.ReadableStream,
  limits: ArchiveLimits
): Promise<void> => {
  if (plan.kind === "skip") {
    await drainEntry(stream);
    return;
  }

  if (plan.kind === "directory") {
    await drainEntry(stream);
    await mkdir(plan.destinationPath, { recursive: true });
    return;
  }

  const contents = await collectEntry(
    stream,
    plan.fileSize,
    limits.maxFileBytes
  );
  await mkdir(path.dirname(plan.destinationPath), { recursive: true });
  await writeFile(plan.destinationPath, contents, { flag: "wx", mode: 0o600 });
};

const extractTarBuffer = async (
  tarBuffer: Buffer,
  destinationRoot: string,
  options: Required<
    Pick<ExtractArchiveOptions, "forbiddenPathBehavior" | "stripComponents">
  > & {
    limits: ArchiveLimits;
  }
): Promise<void> => {
  const archive = extract();
  const state: ExtractionState = {
    entryCount: 0,
    extractedBytes: 0,
    seenPaths: new Set<string>(),
  };

  const completion = new Promise<void>((resolve, reject) => {
    archive.once("finish", resolve);
    archive.once("error", reject);
  });

  archive.on(
    "entry",
    (header: Headers, stream: NodeJS.ReadableStream, next: () => void) => {
      const handleEntry = async (): Promise<void> => {
        const plan = planArchiveEntry(header, destinationRoot, state, options);
        await applyArchiveEntryPlan(plan, stream, options.limits);
      };

      handleEntry()
        .then(next)
        .catch((error: unknown) => {
          archive.destroy(
            error instanceof Error ? error : new Error(String(error))
          );
        });
    }
  );

  archive.end(tarBuffer);
  await completion;
};

const extractTarGzip = async (
  archiveBuffer: Buffer,
  destinationRoot: string,
  options: ExtractArchiveOptions
): Promise<void> => {
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.limits };
  if (archiveBuffer.byteLength > limits.maxCompressedBytes) {
    throw new HostedScanError(
      "The archive exceeds the compressed size limit.",
      {
        code: "ARCHIVE_COMPRESSED_TOO_LARGE",
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

  if (tarBuffer.byteLength > limits.maxExpandedBytes) {
    throw new HostedScanError("The archive exceeds the expanded size limit.", {
      code: "ARCHIVE_EXPANDED_TOO_LARGE",
      status: 422,
    });
  }

  await mkdir(destinationRoot, { recursive: true });
  await extractTarBuffer(tarBuffer, destinationRoot, {
    forbiddenPathBehavior: options.forbiddenPathBehavior,
    limits,
    stripComponents: options.stripComponents ?? 0,
  });
};

export type { ArchiveLimits, ExtractArchiveOptions };
export { DEFAULT_ARCHIVE_LIMITS, extractTarGzip };
