import { createHash } from "node:crypto";
import path from "node:path";
import { extractTarGzip } from "./archive";
import {
  type MaterializedScanSource,
  SnapshotScanQuerySchema,
} from "./contracts";
import { HostedScanError } from "./errors";
import {
  cleanupMaterializationDirectory,
  createMaterializationDirectory,
  resolveProjectRoot,
} from "./materialized-project";
import { SNAPSHOT_MEDIA_TYPE } from "./protocol";
import { readRequestBytes } from "./request-bytes";

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

const getRequestMediaType = (request: Request): string =>
  request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ??
  "";

const parseSnapshotQuery = (request: Request) => {
  const searchParams = new URL(request.url).searchParams;
  const allowedKeys = new Set(["category", "subdirectory"]);

  for (const key of searchParams.keys()) {
    if (!allowedKeys.has(key) || searchParams.getAll(key).length > 1) {
      throw new HostedScanError("The snapshot query is invalid.", {
        code: "INVALID_SNAPSHOT_QUERY",
        status: 400,
      });
    }
  }

  const parsedQuery = SnapshotScanQuerySchema.safeParse({
    category: searchParams.get("category") ?? undefined,
    subdirectory: searchParams.get("subdirectory") ?? undefined,
  });
  if (!parsedQuery.success) {
    throw new HostedScanError("The snapshot query is invalid.", {
      cause: parsedQuery.error,
      code: "INVALID_SNAPSHOT_QUERY",
      status: 400,
    });
  }

  return parsedQuery.data;
};

const materializeSnapshotSource = async (
  request: Request
): Promise<MaterializedScanSource> => {
  if (getRequestMediaType(request) !== SNAPSHOT_MEDIA_TYPE) {
    throw new HostedScanError(
      `Expected Content-Type: ${SNAPSHOT_MEDIA_TYPE}.`,
      {
        code: "UNSUPPORTED_MEDIA_TYPE",
        status: 415,
      }
    );
  }

  const query = parseSnapshotQuery(request);
  const archiveBuffer = await readRequestBytes(request, {
    emptyCode: "EMPTY_SNAPSHOT",
    emptyMessage: "A gzip tar snapshot is required.",
    maxBytes: MAX_SNAPSHOT_BYTES,
    tooLargeCode: "SNAPSHOT_TOO_LARGE",
    tooLargeMessage: "The snapshot exceeds the 4 MiB compressed size limit.",
  });
  const sourceDigest = `sha256:${createHash("sha256")
    .update(archiveBuffer)
    .digest("hex")}`;
  const cleanupDirectory = await createMaterializationDirectory();
  const extractionRoot = path.join(cleanupDirectory, "source");

  try {
    await extractTarGzip(archiveBuffer, extractionRoot, {
      forbiddenPathBehavior: "reject",
      limits: { maxCompressedBytes: MAX_SNAPSHOT_BYTES },
    });
    const projectRoot = await resolveProjectRoot(
      extractionRoot,
      query.subdirectory
    );

    return {
      category: query.category,
      cleanupDirectory,
      projectRoot,
      resolvedRevision: null,
      sourceDigest,
      sourceKind: "snapshot",
    };
  } catch (error) {
    await cleanupMaterializationDirectory(cleanupDirectory);
    throw error;
  }
};

export { MAX_SNAPSHOT_BYTES, materializeSnapshotSource };
