import path from "node:path";
import { z } from "zod";
import {
  type ArchiveLimits,
  DEFAULT_ARCHIVE_LIMITS,
  extractTarGzipStream,
} from "./archive";
import {
  GitHubScanRequestSchema,
  type MaterializedScanSource,
} from "./contracts";
import { HostedScanError } from "./errors";
import {
  materializeSparseGitHubSource,
  planSparseGitHubSource,
} from "./github-sparse-source";
import {
  classifyGitHubProjectPath,
  type GitHubTreeEntry,
  type GitHubTreeResponse,
  GitHubTreeResponseSchema,
  getRetainedGitHubTreeEntries,
  normalizeGitHubTreeEntries,
  type RetainedGitHubTreeEntry,
} from "./github-tree";
import {
  cleanupMaterializationDirectory,
  createMaterializationDirectory,
  resolveProjectRoot,
} from "./materialized-project";
import {
  type ReadBytesOptions,
  readRequestBytes,
  readResponseBytes,
} from "./request-bytes";

const MAX_GITHUB_REQUEST_BYTES = 16 * 1024;
const MAX_GITHUB_METADATA_BYTES = 64 * 1024;
const MAX_GITHUB_TREE_BYTES = 8 * 1024 * 1024;
const MAX_GITHUB_TREE_REQUESTS = 100;
const GITHUB_SOURCE_TIMEOUT_MS = 12_000;
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_ARCHIVE_HOSTS = new Set(["codeload.github.com"]);
const GITHUB_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/;

const GitHubRepositoryMetadataSchema = z.object({ private: z.boolean() });
const GitHubCommitSchema = z.object({
  sha: z.string().regex(COMMIT_SHA_PATTERN),
});

type FetchImplementation = typeof fetch;
type GitHubScanRequest = z.infer<typeof GitHubScanRequestSchema>;
type GitHubSourceMode = "archive" | "auto" | "sparse";

interface ResolvedPublicGitHubSource {
  commitSha: string;
  repository: string;
}

interface MaterializeResolvedGitHubSourceOptions {
  limits?: Partial<ArchiveLimits>;
  sourceMode?: GitHubSourceMode;
  sourceSignal?: AbortSignal;
  treeEntries?: GitHubTreeEntry[];
}

const getGitHubHeaders = (
  includeAuthorization = true,
  accept = "application/vnd.github+json"
): Headers => {
  const headers = new Headers({
    Accept: accept,
    "User-Agent": "shadscan-hosted-api",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  const token = process.env.GITHUB_TOKEN;
  if (token && includeAuthorization) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
};

const throwGitHubRequestError = (
  error: unknown,
  sourceSignal: AbortSignal
): never => {
  if (sourceSignal.aborted && sourceSignal.reason instanceof HostedScanError) {
    throw sourceSignal.reason;
  }

  const errorName = error instanceof Error ? error.name : "";
  const isTimeout =
    sourceSignal.aborted ||
    errorName === "AbortError" ||
    errorName === "TimeoutError";
  throw new HostedScanError(
    isTimeout
      ? "GitHub did not respond before the source timeout."
      : "GitHub could not be reached.",
    {
      cause: error,
      code: isTimeout ? "GITHUB_TIMEOUT" : "GITHUB_UNAVAILABLE",
      retryable: true,
      status: isTimeout ? 504 : 502,
    }
  );
};

const rethrowGitHubSourceError = (
  error: unknown,
  sourceSignal: AbortSignal
): never => {
  if (error instanceof HostedScanError) {
    throw error;
  }

  const errorName = error instanceof Error ? error.name : "";
  if (
    sourceSignal.aborted ||
    errorName === "AbortError" ||
    errorName === "TimeoutError"
  ) {
    return throwGitHubRequestError(error, sourceSignal);
  }

  throw error;
};

const fetchGitHub = async (
  url: string,
  init: RequestInit,
  fetchImplementation: FetchImplementation,
  sourceSignal: AbortSignal
): Promise<Response> => {
  try {
    return await fetchImplementation(url, {
      ...init,
      signal: sourceSignal,
    });
  } catch (error) {
    return throwGitHubRequestError(error, sourceSignal);
  }
};

const readGitHubResponseBytes = async (
  response: Response,
  options: ReadBytesOptions,
  sourceSignal: AbortSignal
): Promise<Buffer> => {
  try {
    return await readResponseBytes(response, {
      ...options,
      signal: sourceSignal,
    });
  } catch (error) {
    if (error instanceof HostedScanError) {
      throw error;
    }

    return throwGitHubRequestError(error, sourceSignal);
  }
};

const throwGitHubResponseError = (
  response: Response,
  notFoundMessage: string
): never => {
  if (response.status === 404) {
    throw new HostedScanError(notFoundMessage, {
      code: "GITHUB_SOURCE_NOT_FOUND",
      status: 422,
    });
  }

  if (response.status === 403 || response.status === 429) {
    throw new HostedScanError(
      "GitHub temporarily refused the source request.",
      {
        code: "GITHUB_RATE_LIMITED",
        retryable: true,
        status: 502,
      }
    );
  }

  throw new HostedScanError("GitHub returned an unexpected response.", {
    code: "GITHUB_UPSTREAM_ERROR",
    retryable: response.status >= 500,
    status: 502,
  });
};

const readGitHubJson = async (
  response: Response,
  notFoundMessage: string,
  sourceSignal: AbortSignal,
  maxBytes = MAX_GITHUB_METADATA_BYTES
): Promise<unknown> => {
  if (!response.ok) {
    throwGitHubResponseError(response, notFoundMessage);
  }

  const responseBuffer = await readGitHubResponseBytes(
    response,
    {
      emptyCode: "GITHUB_INVALID_RESPONSE",
      emptyMessage: "GitHub returned an empty metadata response.",
      emptyRetryable: true,
      emptyStatus: 502,
      maxBytes,
      tooLargeCode: "GITHUB_INVALID_RESPONSE",
      tooLargeMessage: "GitHub returned an oversized metadata response.",
      tooLargeRetryable: true,
      tooLargeStatus: 502,
    },
    sourceSignal
  );
  try {
    return JSON.parse(responseBuffer.toString("utf8"));
  } catch (error) {
    throw new HostedScanError("GitHub returned invalid metadata.", {
      cause: error,
      code: "GITHUB_INVALID_RESPONSE",
      retryable: true,
      status: 502,
    });
  }
};

const assertPublicGitHubRepository = async (
  repository: string,
  fetchImplementation: FetchImplementation,
  sourceSignal: AbortSignal
): Promise<void> => {
  const response = await fetchGitHub(
    `${GITHUB_API_ORIGIN}/repos/${repository}`,
    { headers: getGitHubHeaders(), redirect: "error" },
    fetchImplementation,
    sourceSignal
  );
  const metadata = GitHubRepositoryMetadataSchema.safeParse(
    await readGitHubJson(
      response,
      "The public GitHub repository was not found.",
      sourceSignal
    )
  );
  if (!metadata.success) {
    throw new HostedScanError("GitHub returned invalid repository metadata.", {
      cause: metadata.error,
      code: "GITHUB_INVALID_RESPONSE",
      retryable: true,
      status: 502,
    });
  }

  if (metadata.data.private) {
    throw new HostedScanError(
      "Only public GitHub repositories are supported.",
      {
        code: "PRIVATE_REPOSITORY_UNSUPPORTED",
        status: 422,
      }
    );
  }
};

const resolveGitHubRevision = async (
  repository: string,
  revision: string,
  fetchImplementation: FetchImplementation,
  sourceSignal: AbortSignal
): Promise<string> => {
  const response = await fetchGitHub(
    `${GITHUB_API_ORIGIN}/repos/${repository}/commits/${encodeURIComponent(revision)}`,
    { headers: getGitHubHeaders(), redirect: "error" },
    fetchImplementation,
    sourceSignal
  );
  const commit = GitHubCommitSchema.safeParse(
    await readGitHubJson(
      response,
      "The requested GitHub revision was not found.",
      sourceSignal
    )
  );
  if (!commit.success) {
    throw new HostedScanError("GitHub returned invalid commit metadata.", {
      cause: commit.error,
      code: "GITHUB_INVALID_RESPONSE",
      retryable: true,
      status: 502,
    });
  }

  return commit.data.sha;
};

const createGitHubSourceSignal = (
  deadlineSignal?: AbortSignal
): AbortSignal => {
  const sourceTimeoutSignal = AbortSignal.timeout(GITHUB_SOURCE_TIMEOUT_MS);
  return deadlineSignal
    ? AbortSignal.any([deadlineSignal, sourceTimeoutSignal])
    : sourceTimeoutSignal;
};

const resolvePublicGitHubSourceWithSignal = async (
  repository: string,
  revision: string,
  fetchImplementation: FetchImplementation,
  sourceSignal: AbortSignal
): Promise<ResolvedPublicGitHubSource> => {
  try {
    sourceSignal.throwIfAborted();
    await assertPublicGitHubRepository(
      repository,
      fetchImplementation,
      sourceSignal
    );
    const commitSha = await resolveGitHubRevision(
      repository,
      revision,
      fetchImplementation,
      sourceSignal
    );
    return { commitSha, repository };
  } catch (error) {
    return rethrowGitHubSourceError(error, sourceSignal);
  }
};

const resolvePublicGitHubSource = (
  repository: string,
  revision: string,
  fetchImplementation: FetchImplementation = fetch,
  deadlineSignal?: AbortSignal,
  sharedSourceSignal?: AbortSignal
): Promise<ResolvedPublicGitHubSource> =>
  resolvePublicGitHubSourceWithSignal(
    repository,
    revision,
    fetchImplementation,
    sharedSourceSignal ?? createGitHubSourceSignal(deadlineSignal)
  );

const createTreeEntryLimitError = (
  limit: number,
  observed: number
): HostedScanError =>
  new HostedScanError("The GitHub tree contains too many entries.", {
    code: "ARCHIVE_TOO_MANY_ENTRIES",
    sourceLimit: {
      kind: "archive_entries",
      limit,
      observed,
      unit: "entries",
    },
    status: 422,
  });

const fetchGitHubTreePage = async (
  repository: string,
  treeSha: string,
  recursive: boolean,
  fetchImplementation: FetchImplementation,
  sourceSignal: AbortSignal
): Promise<GitHubTreeResponse> => {
  const recursiveQuery = recursive ? "?recursive=1" : "";
  const response = await fetchGitHub(
    `${GITHUB_API_ORIGIN}/repos/${repository}/git/trees/${treeSha}${recursiveQuery}`,
    { headers: getGitHubHeaders(), redirect: "error" },
    fetchImplementation,
    sourceSignal
  );
  const parsedTree = GitHubTreeResponseSchema.safeParse(
    await readGitHubJson(
      response,
      "The GitHub source tree was not found.",
      sourceSignal,
      MAX_GITHUB_TREE_BYTES
    )
  );
  if (!parsedTree.success) {
    throw new HostedScanError("GitHub returned an invalid source tree.", {
      cause: parsedTree.error,
      code: "GITHUB_INVALID_RESPONSE",
      retryable: true,
      status: 502,
    });
  }
  return parsedTree.data;
};

const loadCompleteGitHubTree = async (
  repository: string,
  commitSha: string,
  maxEntries: number,
  fetchImplementation: FetchImplementation,
  sourceSignal: AbortSignal
): Promise<GitHubTreeEntry[]> => {
  const recursiveTree = await fetchGitHubTreePage(
    repository,
    commitSha,
    true,
    fetchImplementation,
    sourceSignal
  );
  if (recursiveTree.tree.length > maxEntries) {
    throw createTreeEntryLimitError(maxEntries, recursiveTree.tree.length);
  }
  if (!recursiveTree.truncated) {
    return normalizeGitHubTreeEntries(recursiveTree.tree);
  }

  const entries: GitHubTreeEntry[] = [];
  const pendingTrees = [{ pathPrefix: "", sha: commitSha }];
  let requestCount = 1;
  while (pendingTrees.length > 0) {
    sourceSignal.throwIfAborted();
    if (requestCount >= MAX_GITHUB_TREE_REQUESTS) {
      throw new HostedScanError(
        "The truncated GitHub tree requires too many metadata requests.",
        {
          code: "GITHUB_TREE_TOO_LARGE",
          status: 422,
        }
      );
    }
    const pendingTree = pendingTrees.shift();
    if (!pendingTree) {
      break;
    }
    const treePage = await fetchGitHubTreePage(
      repository,
      pendingTree.sha,
      false,
      fetchImplementation,
      sourceSignal
    );
    requestCount += 1;
    for (const entry of treePage.tree) {
      const fullPath = pendingTree.pathPrefix
        ? `${pendingTree.pathPrefix}/${entry.path}`
        : entry.path;
      const resolvedEntry = { ...entry, path: fullPath };
      entries.push(resolvedEntry);
      if (entries.length > maxEntries) {
        throw createTreeEntryLimitError(maxEntries, entries.length);
      }
      if (entry.type === "tree") {
        pendingTrees.push({ pathPrefix: fullPath, sha: entry.sha });
      }
    }
  }

  return normalizeGitHubTreeEntries(entries);
};

const loadGitHubRepositoryTree = async (
  repository: string,
  commitSha: string,
  maxEntries: number,
  fetchImplementation: FetchImplementation = fetch,
  deadlineSignal?: AbortSignal,
  sharedSourceSignal?: AbortSignal
): Promise<GitHubTreeEntry[]> => {
  const sourceSignal =
    sharedSourceSignal ?? createGitHubSourceSignal(deadlineSignal);
  try {
    return await loadCompleteGitHubTree(
      repository,
      commitSha,
      maxEntries,
      fetchImplementation,
      sourceSignal
    );
  } catch (error) {
    return rethrowGitHubSourceError(error, sourceSignal);
  }
};

const getAllowedRedirectUrl = (response: Response): string => {
  const location = response.headers.get("location");
  if (!GITHUB_REDIRECT_STATUSES.has(response.status)) {
    throwGitHubResponseError(response, "The GitHub archive was not found.");
  }
  if (!location) {
    throw new HostedScanError("GitHub returned an invalid archive redirect.", {
      code: "GITHUB_UNSAFE_REDIRECT",
      status: 502,
    });
  }

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(location);
  } catch (error) {
    throw new HostedScanError("GitHub returned an invalid archive redirect.", {
      cause: error,
      code: "GITHUB_UNSAFE_REDIRECT",
      status: 502,
    });
  }

  if (
    redirectUrl.protocol !== "https:" ||
    !GITHUB_ARCHIVE_HOSTS.has(redirectUrl.hostname) ||
    redirectUrl.username.length > 0 ||
    redirectUrl.password.length > 0 ||
    (redirectUrl.port.length > 0 && redirectUrl.port !== "443")
  ) {
    throw new HostedScanError("GitHub returned an unsafe archive redirect.", {
      code: "GITHUB_UNSAFE_REDIRECT",
      status: 502,
    });
  }

  return redirectUrl.toString();
};

const fetchGitHubArchiveResponse = async (
  repository: string,
  commitSha: string,
  fetchImplementation: FetchImplementation,
  sourceSignal: AbortSignal
): Promise<Response> => {
  const initialResponse = await fetchGitHub(
    `${GITHUB_API_ORIGIN}/repos/${repository}/tarball/${commitSha}`,
    { headers: getGitHubHeaders(false), redirect: "manual" },
    fetchImplementation,
    sourceSignal
  );
  const archiveResponse = initialResponse.ok
    ? initialResponse
    : await fetchGitHub(
        getAllowedRedirectUrl(initialResponse),
        { headers: getGitHubHeaders(false), redirect: "error" },
        fetchImplementation,
        sourceSignal
      );

  if (!archiveResponse.ok) {
    throwGitHubResponseError(
      archiveResponse,
      "The GitHub archive was not found."
    );
  }

  return archiveResponse;
};

const downloadGitHubArchive = async (
  repository: string,
  commitSha: string,
  fetchImplementation: FetchImplementation,
  sourceSignal: AbortSignal
): Promise<Buffer> => {
  const archiveResponse = await fetchGitHubArchiveResponse(
    repository,
    commitSha,
    fetchImplementation,
    sourceSignal
  );

  return readGitHubResponseBytes(
    archiveResponse,
    {
      emptyCode: "GITHUB_INVALID_RESPONSE",
      emptyMessage: "GitHub returned an empty source archive.",
      emptyRetryable: true,
      emptyStatus: 502,
      maxBytes: DEFAULT_ARCHIVE_LIMITS.maxCompressedBytes,
      tooLargeCode: "GITHUB_ARCHIVE_TOO_LARGE",
      tooLargeMessage: "The GitHub archive exceeds the compressed size limit.",
      tooLargeSourceLimit: {
        kind: "compressed_bytes",
        unit: "bytes",
      },
    },
    sourceSignal
  );
};

const getResponseContentLength = (response: Response): number | undefined => {
  const contentLength = response.headers.get("content-length");
  if (!contentLength) {
    return;
  }

  const parsedLength = Number.parseInt(contentLength, 10);
  return Number.isSafeInteger(parsedLength) && parsedLength >= 0
    ? parsedLength
    : undefined;
};

const downloadGitHubBlob = async (
  repository: string,
  entry: RetainedGitHubTreeEntry,
  maxBytes: number,
  fetchImplementation: FetchImplementation,
  sourceSignal: AbortSignal
): Promise<Buffer> => {
  if (entry.size === 0) {
    return Buffer.alloc(0);
  }
  const response = await fetchGitHub(
    `${GITHUB_API_ORIGIN}/repos/${repository}/git/blobs/${entry.sha}`,
    {
      headers: getGitHubHeaders(true, "application/vnd.github.raw+json"),
      redirect: "error",
    },
    fetchImplementation,
    sourceSignal
  );
  if (!response.ok) {
    throwGitHubResponseError(response, "A GitHub source blob was not found.");
  }
  return readGitHubResponseBytes(
    response,
    {
      maxBytes,
      tooLargeCode: "GITHUB_INVALID_RESPONSE",
      tooLargeMessage: "GitHub returned an oversized source blob.",
      tooLargeRetryable: true,
      tooLargeStatus: 502,
    },
    sourceSignal
  );
};

const parseGitHubScanRequest = async (
  request: Request,
  signal?: AbortSignal
): Promise<GitHubScanRequest> => {
  const requestBuffer = await readRequestBytes(request, {
    maxBytes: MAX_GITHUB_REQUEST_BYTES,
    signal,
    tooLargeCode: "REQUEST_TOO_LARGE",
    tooLargeMessage: "The JSON scan request exceeds the size limit.",
  });

  let requestData: unknown;
  try {
    requestData = JSON.parse(requestBuffer.toString("utf8"));
  } catch (error) {
    throw new HostedScanError("The request body must be valid JSON.", {
      cause: error,
      code: "INVALID_JSON",
      status: 400,
    });
  }

  const parsedRequest = GitHubScanRequestSchema.safeParse(requestData);
  if (!parsedRequest.success) {
    throw new HostedScanError("The GitHub scan request is invalid.", {
      cause: parsedRequest.error,
      code: "INVALID_SCAN_REQUEST",
      status: 400,
    });
  }

  return parsedRequest.data;
};

const materializeResolvedGitHubSource = async (
  requestData: GitHubScanRequest,
  resolvedSource: ResolvedPublicGitHubSource,
  fetchImplementation: FetchImplementation = fetch,
  deadlineSignal?: AbortSignal,
  options: MaterializeResolvedGitHubSourceOptions = {}
): Promise<MaterializedScanSource> => {
  const { repository, subdirectory } = requestData.source;
  const sourceSignal =
    options.sourceSignal ?? createGitHubSourceSignal(deadlineSignal);
  const limits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.limits };
  let cleanupDirectory: string | undefined;

  try {
    sourceSignal.throwIfAborted();
    if (resolvedSource.repository !== repository) {
      throw new HostedScanError("The resolved GitHub source is invalid.", {
        code: "GITHUB_INVALID_RESPONSE",
        status: 500,
      });
    }

    const retainedEntries = options.treeEntries
      ? getRetainedGitHubTreeEntries(options.treeEntries, subdirectory)
      : undefined;
    const sparsePlan = retainedEntries
      ? planSparseGitHubSource(retainedEntries, limits)
      : undefined;
    const useSparseAcquisition =
      options.sourceMode !== "archive" &&
      sparsePlan?.useSparseAcquisition === true;

    cleanupDirectory = await createMaterializationDirectory();
    const extractionRoot = path.join(cleanupDirectory, "source");
    let sourceDigest: string;

    if (useSparseAcquisition && sparsePlan) {
      sourceDigest = await materializeSparseGitHubSource(
        sparsePlan,
        extractionRoot,
        (entry, signal) =>
          downloadGitHubBlob(
            repository,
            entry,
            entry.size ?? limits.maxFileBytes,
            fetchImplementation,
            signal ?? sourceSignal
          ),
        sourceSignal
      );
    } else {
      const archiveResponse = await fetchGitHubArchiveResponse(
        repository,
        resolvedSource.commitSha,
        fetchImplementation,
        sourceSignal
      );
      if (!archiveResponse.body) {
        throw new HostedScanError("GitHub returned an empty source archive.", {
          code: "GITHUB_INVALID_RESPONSE",
          retryable: true,
          status: 502,
        });
      }
      const streamedArchive = await extractTarGzipStream(
        archiveResponse.body,
        extractionRoot,
        {
          compressedSize: getResponseContentLength(archiveResponse),
          entryPolicy: (relativePath) =>
            classifyGitHubProjectPath(relativePath, subdirectory),
          forbiddenPathBehavior: "skip",
          limits,
          signal: sourceSignal,
          stripComponents: 1,
        }
      );
      sourceDigest = streamedArchive.sourceDigest;
    }
    sourceSignal.throwIfAborted();
    const projectRoot = await resolveProjectRoot(extractionRoot, subdirectory);
    sourceSignal.throwIfAborted();

    return {
      category: requestData.category,
      cleanupDirectory,
      projectRoot,
      resolvedRevision: resolvedSource.commitSha,
      sourceDigest,
      sourceKind: "git",
      sourceRoot: extractionRoot,
    };
  } catch (error) {
    if (cleanupDirectory) {
      await cleanupMaterializationDirectory(cleanupDirectory);
    }
    return rethrowGitHubSourceError(error, sourceSignal);
  }
};

const materializeGitHubSource = async (
  requestData: GitHubScanRequest,
  fetchImplementation: FetchImplementation = fetch,
  deadlineSignal?: AbortSignal,
  limits?: Partial<ArchiveLimits>
): Promise<MaterializedScanSource> => {
  // One source signal bounds the entire acquisition so the GitHub timeout
  // applies end to end instead of resetting between resolve and materialize.
  const sourceSignal = createGitHubSourceSignal(deadlineSignal);
  const resolvedSource = await resolvePublicGitHubSourceWithSignal(
    requestData.source.repository,
    requestData.source.revision,
    fetchImplementation,
    sourceSignal
  );
  return materializeResolvedGitHubSource(
    requestData,
    resolvedSource,
    fetchImplementation,
    deadlineSignal,
    { limits, sourceMode: "archive", sourceSignal }
  );
};

export type {
  FetchImplementation,
  GitHubScanRequest,
  GitHubSourceMode,
  MaterializeResolvedGitHubSourceOptions,
  ResolvedPublicGitHubSource,
};
export {
  downloadGitHubArchive,
  fetchGitHubArchiveResponse,
  GITHUB_SOURCE_TIMEOUT_MS,
  loadGitHubRepositoryTree,
  materializeGitHubSource,
  materializeResolvedGitHubSource,
  parseGitHubScanRequest,
  resolveGitHubRevision,
  resolvePublicGitHubSource,
};
