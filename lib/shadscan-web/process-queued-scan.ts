import { HostedScanError } from "../shadscan-api/errors";
import {
  type FetchImplementation,
  loadGitHubRepositoryTree,
  materializeResolvedGitHubSource,
  resolvePublicGitHubSource,
} from "../shadscan-api/github-source";
import {
  discoverGitHubProjectCandidates,
  type GitHubTreeEntry,
} from "../shadscan-api/github-tree";
import { runHostedScan } from "../shadscan-api/run-hosted-scan";
import { getWebAsyncConfig, type WebAsyncConfig } from "./async-config";
import { toWebScanError } from "./errors";
import {
  createScanCacheDescriptor,
  getScanCacheConfig,
  type ScanCacheConfig,
  type ScanCacheIdentity,
  writeScanCache,
} from "./scan-cache";
import {
  type ImmutableGitHubScanInput,
  ImmutableGitHubScanInputSchema,
} from "./scan-dispatcher";
import {
  claimScanJob,
  completeScanJob,
  recordScanJobFailure,
} from "./scan-jobs";
import { getWebSourceConfig, type WebSourceConfig } from "./source-config";

const ASYNC_SCAN_DEADLINE_MS = 240_000;

class QueuedScanRetryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "QueuedScanRetryError";
  }
}

interface ProcessQueuedScanDependencies {
  asyncConfig?: WebAsyncConfig;
  cacheConfig?: ScanCacheConfig;
  claimJob?: typeof claimScanJob;
  completeJob?: typeof completeScanJob;
  fetchImplementation?: FetchImplementation;
  loadTree?: typeof loadGitHubRepositoryTree;
  materializeSource?: typeof materializeResolvedGitHubSource;
  recordFailure?: typeof recordScanJobFailure;
  resolveSource?: typeof resolvePublicGitHubSource;
  runScan?: typeof runHostedScan;
  signal?: AbortSignal;
  sourceConfig?: WebSourceConfig;
  writeCache?: typeof writeScanCache;
}

type QueuedScanProcessOutcome = "completed" | "discarded" | "terminal";

const getQueueSignal = (signal?: AbortSignal): AbortSignal => {
  const deadlineSignal = AbortSignal.timeout(ASYNC_SCAN_DEADLINE_MS);
  return signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal;
};

const createCacheIdentity = (
  message: ImmutableGitHubScanInput
): ScanCacheIdentity => ({
  category: message.category,
  commitSha: message.commitSha,
  projectPath: message.projectPath,
  repositoryKey: message.repository.toLowerCase(),
});

const assertQueueMessageIdentity = (
  message: ImmutableGitHubScanInput,
  identity: ScanCacheIdentity
): void => {
  if (createScanCacheDescriptor(identity).cacheKey !== message.cacheKey) {
    throw new HostedScanError("The queued scan identity is invalid.", {
      code: "INVALID_SCAN_REQUEST",
      status: 400,
    });
  }
};

const assertSelectedProjectExists = (
  treeEntries: GitHubTreeEntry[],
  projectPath: string
): void => {
  const projects = discoverGitHubProjectCandidates(treeEntries);
  if (!projects.some((project) => project.path === projectPath)) {
    throw new HostedScanError(
      "No supported React project was found at the queued path.",
      {
        code: "PROJECT_ROOT_NOT_FOUND",
        status: 422,
      }
    );
  }
};

const handleQueuedScanFailure = async (
  error: unknown,
  message: ImmutableGitHubScanInput,
  attemptCount: number,
  asyncConfig: WebAsyncConfig,
  dependencies: ProcessQueuedScanDependencies
): Promise<"terminal"> => {
  const publicError = toWebScanError(error);
  const canRetry =
    publicError.retryable && attemptCount < asyncConfig.maxAttempts;
  const recordFailure = dependencies.recordFailure ?? recordScanJobFailure;
  await recordFailure(
    message.jobId,
    publicError,
    canRetry,
    asyncConfig.maxAttempts
  );
  if (canRetry) {
    throw new QueuedScanRetryError(publicError.message, { cause: error });
  }
  return "terminal";
};

const processQueuedScan = async (
  messageInput: unknown,
  dependencies: ProcessQueuedScanDependencies = {}
): Promise<QueuedScanProcessOutcome> => {
  const parsedMessage = ImmutableGitHubScanInputSchema.safeParse(messageInput);
  if (!parsedMessage.success) {
    return "discarded";
  }
  const message = parsedMessage.data;
  const identity = createCacheIdentity(message);
  const asyncConfig = dependencies.asyncConfig ?? getWebAsyncConfig();
  const claimJob = dependencies.claimJob ?? claimScanJob;
  const claim = await claimJob(message.jobId, asyncConfig);
  if (!claim) {
    return "discarded";
  }
  if (claim.action === "completed") {
    return "completed";
  }
  if (claim.action === "terminal") {
    return "terminal";
  }
  if (claim.action === "busy") {
    throw new QueuedScanRetryError("The queued scanner is at capacity.");
  }

  try {
    assertQueueMessageIdentity(message, identity);
    if (claim.cacheKey !== message.cacheKey) {
      throw new HostedScanError("The queued scan job is invalid.", {
        code: "INVALID_SCAN_REQUEST",
        status: 400,
      });
    }

    const signal = getQueueSignal(dependencies.signal);
    const sourceConfig = dependencies.sourceConfig ?? getWebSourceConfig();
    const resolveSource =
      dependencies.resolveSource ?? resolvePublicGitHubSource;
    const resolvedSource = await resolveSource(
      message.repository,
      message.commitSha,
      dependencies.fetchImplementation,
      signal,
      signal
    );
    signal.throwIfAborted();
    const loadTree = dependencies.loadTree ?? loadGitHubRepositoryTree;
    const treeEntries = await loadTree(
      message.repository,
      message.commitSha,
      sourceConfig.limits.maxRawEntries,
      dependencies.fetchImplementation,
      signal,
      signal
    );
    assertSelectedProjectExists(treeEntries, message.projectPath);

    const materializeSource =
      dependencies.materializeSource ?? materializeResolvedGitHubSource;
    const source = await materializeSource(
      {
        category: message.category,
        source: {
          kind: "github",
          repository: message.repository,
          revision: message.commitSha,
          subdirectory: message.projectPath,
        },
      },
      resolvedSource,
      dependencies.fetchImplementation,
      signal,
      {
        limits: sourceConfig.limits,
        sourceMode: sourceConfig.mode,
        sourceSignal: signal,
        treeEntries,
      }
    );
    const runScan = dependencies.runScan ?? runHostedScan;
    const result = await runScan(source, signal);
    signal.throwIfAborted();

    const cacheConfig = dependencies.cacheConfig ?? getScanCacheConfig();
    const writeCache = dependencies.writeCache ?? writeScanCache;
    await writeCache(identity, result, cacheConfig.ttlSeconds);
    const completeJob = dependencies.completeJob ?? completeScanJob;
    await completeJob(message.jobId, message.cacheKey);
    return "completed";
  } catch (error) {
    return handleQueuedScanFailure(
      error,
      message,
      claim.attempts,
      asyncConfig,
      dependencies
    );
  }
};

export type { ProcessQueuedScanDependencies, QueuedScanProcessOutcome };
export { ASYNC_SCAN_DEADLINE_MS, processQueuedScan, QueuedScanRetryError };
