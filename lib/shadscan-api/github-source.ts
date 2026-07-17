import { createHash } from "node:crypto";
import path from "node:path";
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
import { readRequestBytes, readResponseBytes } from "./request-bytes";

const MAX_GITHUB_REQUEST_BYTES = 16 * 1024;
const MAX_GITHUB_METADATA_BYTES = 64 * 1024;
const GITHUB_TIMEOUT_MS = 8000;
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

const fetchGitHub = async (
  url: string,
  init: RequestInit,
  fetchImplementation: FetchImplementation
): Promise<Response> => {
  try {
    return await fetchImplementation(url, {
      ...init,
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "";
    const isTimeout =
      errorName === "AbortError" || errorName === "TimeoutError";
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
  notFoundMessage: string
): Promise<unknown> => {
  if (!response.ok) {
    throwGitHubResponseError(response, notFoundMessage);
  }

  const responseBuffer = await readResponseBytes(response, {
    emptyCode: "GITHUB_INVALID_RESPONSE",
    emptyMessage: "GitHub returned an empty metadata response.",
    maxBytes: MAX_GITHUB_METADATA_BYTES,
    tooLargeCode: "GITHUB_INVALID_RESPONSE",
    tooLargeMessage: "GitHub returned an oversized metadata response.",
  });
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
  fetchImplementation: FetchImplementation
): Promise<void> => {
  const response = await fetchGitHub(
    `${GITHUB_API_ORIGIN}/repos/${repository}`,
    { headers: getGitHubHeaders(), redirect: "error" },
    fetchImplementation
  );
  const metadata = GitHubRepositoryMetadataSchema.safeParse(
    await readGitHubJson(
      response,
      "The public GitHub repository was not found."
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
  fetchImplementation: FetchImplementation
): Promise<string> => {
  const response = await fetchGitHub(
    `${GITHUB_API_ORIGIN}/repos/${repository}/commits/${encodeURIComponent(revision)}`,
    { headers: getGitHubHeaders(), redirect: "error" },
    fetchImplementation
  );
  const commit = GitHubCommitSchema.safeParse(
    await readGitHubJson(
      response,
      "The requested GitHub revision was not found."
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
  fetchImplementation: FetchImplementation
): Promise<Buffer> => {
  const initialResponse = await fetchGitHub(
    `${GITHUB_API_ORIGIN}/repos/${repository}/tarball/${commitSha}`,
    { headers: getGitHubHeaders(), redirect: "manual" },
    fetchImplementation
  );
  const archiveResponse = initialResponse.ok
    ? initialResponse
    : await fetchGitHub(
        getAllowedRedirectUrl(initialResponse),
        { headers: getGitHubHeaders(false), redirect: "error" },
        fetchImplementation
      );

  if (!archiveResponse.ok) {
    throwGitHubResponseError(
      archiveResponse,
      "The GitHub archive was not found."
    );
  }

  return readResponseBytes(archiveResponse, {
    emptyCode: "GITHUB_EMPTY_ARCHIVE",
    emptyMessage: "GitHub returned an empty source archive.",
    maxBytes: DEFAULT_ARCHIVE_LIMITS.maxCompressedBytes,
    tooLargeCode: "GITHUB_ARCHIVE_TOO_LARGE",
    tooLargeMessage: "The GitHub archive exceeds the compressed size limit.",
  });
};

const parseGitHubScanRequest = async (
  request: Request
): Promise<GitHubScanRequest> => {
  const requestBuffer = await readRequestBytes(request, {
    maxBytes: MAX_GITHUB_REQUEST_BYTES,
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
  fetchImplementation: FetchImplementation = fetch
): Promise<MaterializedScanSource> => {
  const { repository, revision, subdirectory } = requestData.source;
  await assertPublicGitHubRepository(repository, fetchImplementation);
  const commitSha = await resolveGitHubRevision(
    repository,
    revision,
    fetchImplementation
  );
  const archiveBuffer = await downloadGitHubArchive(
    repository,
    commitSha,
    fetchImplementation
  );
  const sourceDigest = `sha256:${createHash("sha256")
    .update(archiveBuffer)
    .digest("hex")}`;
  const cleanupDirectory = await createMaterializationDirectory();
  const extractionRoot = path.join(cleanupDirectory, "source");

  try {
    await extractTarGzip(archiveBuffer, extractionRoot, {
      forbiddenPathBehavior: "skip",
      stripComponents: 1,
    });
    const projectRoot = await resolveProjectRoot(extractionRoot, subdirectory);

    return {
      category: requestData.category,
      cleanupDirectory,
      projectRoot,
      resolvedRevision: commitSha,
      sourceDigest,
      sourceKind: "git",
    };
  } catch (error) {
    await cleanupMaterializationDirectory(cleanupDirectory);
    throw error;
  }
};

export type { FetchImplementation, GitHubScanRequest };
export {
  downloadGitHubArchive,
  materializeGitHubSource,
  parseGitHubScanRequest,
  resolveGitHubRevision,
};
