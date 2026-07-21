import { createHash } from "node:crypto";
import path from "node:path";
import { classifyScanInputPath } from "@shadscan/cli";
import { z } from "zod";
import { DEFAULT_ARCHIVE_LIMITS, extractTarGzip } from "./archive";
import {
  GitHubScanRequestSchema,
  type MaterializedScanSource,
} from "./contracts";
import { HostedScanError } from "./errors";
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

const getGitHubHeaders = (includeAuthorization = true): Headers => {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
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
  sourceSignal: AbortSignal
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
      maxBytes: MAX_GITHUB_METADATA_BYTES,
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

const downloadGitHubArchive = async (
  repository: string,
  commitSha: string,
  fetchImplementation: FetchImplementation,
  sourceSignal: AbortSignal
): Promise<Buffer> => {
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

const materializeGitHubSource = async (
  requestData: GitHubScanRequest,
  fetchImplementation: FetchImplementation = fetch,
  deadlineSignal?: AbortSignal
): Promise<MaterializedScanSource> => {
  const { repository, revision, subdirectory } = requestData.source;
  const sourceTimeoutSignal = AbortSignal.timeout(GITHUB_SOURCE_TIMEOUT_MS);
  const sourceSignal = deadlineSignal
    ? AbortSignal.any([deadlineSignal, sourceTimeoutSignal])
    : sourceTimeoutSignal;
  let cleanupDirectory: string | undefined;

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
    const archiveBuffer = await downloadGitHubArchive(
      repository,
      commitSha,
      fetchImplementation,
      sourceSignal
    );
    sourceSignal.throwIfAborted();
    const sourceDigest = `sha256:${createHash("sha256")
      .update(archiveBuffer)
      .digest("hex")}`;
    cleanupDirectory = await createMaterializationDirectory();
    const extractionRoot = path.join(cleanupDirectory, "source");

    await extractTarGzip(archiveBuffer, extractionRoot, {
      entryPolicy: classifyScanInputPath,
      forbiddenPathBehavior: "skip",
      signal: sourceSignal,
      stripComponents: 1,
    });
    sourceSignal.throwIfAborted();
    const projectRoot = await resolveProjectRoot(extractionRoot, subdirectory);
    sourceSignal.throwIfAborted();

    return {
      category: requestData.category,
      cleanupDirectory,
      projectRoot,
      resolvedRevision: commitSha,
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

export type { FetchImplementation, GitHubScanRequest };
export {
  downloadGitHubArchive,
  GITHUB_SOURCE_TIMEOUT_MS,
  materializeGitHubSource,
  parseGitHubScanRequest,
  resolveGitHubRevision,
};
