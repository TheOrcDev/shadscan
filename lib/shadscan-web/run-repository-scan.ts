import {
  type HostedScanAdmissionController,
  hostedScanAdmissionController,
} from "../shadscan-api/admission";
import {
  GitHubScanRequestSchema,
  type HostedScanResponse,
  HostedScanResponseSchema,
} from "../shadscan-api/contracts";
import { runWithHostedScanDeadline } from "../shadscan-api/deadline";
import { HostedScanError } from "../shadscan-api/errors";
import {
  type FetchImplementation,
  loadGitHubRepositoryTree,
  materializeResolvedGitHubSource,
  resolvePublicGitHubSource,
} from "../shadscan-api/github-source";
import { discoverGitHubProjectCandidates } from "../shadscan-api/github-tree";
import { runHostedScan } from "../shadscan-api/run-hosted-scan";
import { getWebAsyncConfig, type WebAsyncConfig } from "./async-config";
import {
  WebProjectSelectionStateSchema,
  WebScanCompleteStateSchema,
  WebScanQueuedStateSchema,
} from "./contracts";
import { enforceWebDiscoveryRateLimit } from "./discovery-rate-limit";
import { asWebScanServiceError } from "./errors";
import { normalizeGitHubRepository } from "./normalize-repository";
import { enforceWebScanRateLimit, type WebRateLimitInput } from "./rate-limit";
import {
  getScanCacheConfig,
  readScanCacheFailOpen,
  type ScanCacheConfig,
  type ScanCacheIdentity,
  writeScanCacheFailOpen,
} from "./scan-cache";
import {
  type ScanDispatcher,
  SynchronousScanDispatcher,
  VercelQueueScanDispatcher,
} from "./scan-dispatcher";
import { getWebSourceConfig, type WebSourceConfig } from "./source-config";
import type {
  NormalizedGitHubRepository,
  WebProjectOption,
  WebProjectSelectionState,
  WebScanCompleteState,
  WebScanQueuedState,
} from "./types";
import { classifyWebScanWorkload } from "./workload";

interface ExecuteWebRepositoryScanInput {
  clientAddress: string;
  projectPath?: unknown;
  repositoryInput: unknown;
}

interface ExecuteWebRepositoryScanDependencies {
  admissionController?: HostedScanAdmissionController;
  asyncConfig?: WebAsyncConfig;
  asyncDispatcher?: ScanDispatcher;
  cacheConfig?: ScanCacheConfig;
  classifyWorkload?: typeof classifyWebScanWorkload;
  deadlineMs?: number;
  enforceDiscoveryRateLimit?: (
    input: WebRateLimitInput
  ) => Promise<unknown> | unknown;
  enforceRateLimit?: (input: WebRateLimitInput) => Promise<unknown> | unknown;
  fetchImplementation?: FetchImplementation;
  loadTree?: typeof loadGitHubRepositoryTree;
  materializeSource?: typeof materializeResolvedGitHubSource;
  readCache?: typeof readScanCacheFailOpen;
  resolveSource?: typeof resolvePublicGitHubSource;
  runScan?: (
    source: Parameters<typeof runHostedScan>[0],
    signal?: AbortSignal
  ) => HostedScanResponse | Promise<HostedScanResponse>;
  sourceConfig?: WebSourceConfig;
  synchronousDispatcher?: ScanDispatcher;
  writeCache?: typeof writeScanCacheFailOpen;
}

type WebRepositoryScanResult =
  | WebProjectSelectionState
  | WebScanCompleteState
  | WebScanQueuedState;

const selectProjectPath = (
  projects: WebProjectOption[],
  requestedPath?: string
): string | undefined => {
  if (requestedPath) {
    if (projects.some((project) => project.path === requestedPath)) {
      return requestedPath;
    }
    throw new HostedScanError(
      "The selected project path was not found in the repository.",
      {
        code: "PROJECT_ROOT_NOT_FOUND",
        status: 422,
      }
    );
  }

  if (projects.some((project) => project.path === ".")) {
    return ".";
  }
  return projects.length === 1 ? projects[0]?.path : undefined;
};

const resolveProjectSelection = (
  projects: WebProjectOption[],
  repository: NormalizedGitHubRepository
): string | WebProjectSelectionState => {
  if (projects.length === 0) {
    throw new HostedScanError(
      "No supported React project was found in the repository.",
      {
        code: "PROJECT_ROOT_NOT_FOUND",
        status: 422,
      }
    );
  }

  return (
    selectProjectPath(projects, repository.projectPath) ??
    WebProjectSelectionStateSchema.parse({
      projects,
      repository: repository.repository,
      repositoryInput: repository.repositoryInput,
      repositoryUrl: repository.repositoryUrl,
      status: "project_selection_required",
    })
  );
};

const enforceAsyncScanRateLimit = async (
  isAsync: boolean,
  enforceRateLimit: (input: WebRateLimitInput) => Promise<unknown> | unknown,
  rateLimitInput: WebRateLimitInput,
  signal: AbortSignal
): Promise<void> => {
  if (!isAsync) {
    return;
  }
  await enforceRateLimit(rateLimitInput);
  signal.throwIfAborted();
};

const executeWebRepositoryScan = async (
  input: ExecuteWebRepositoryScanInput,
  dependencies: ExecuteWebRepositoryScanDependencies = {}
): Promise<WebRepositoryScanResult> => {
  try {
    return await runWithHostedScanDeadline(async (signal) => {
      const repository = normalizeGitHubRepository(
        input.repositoryInput,
        input.projectPath
      );
      const rateLimitInput = {
        clientAddress: input.clientAddress,
        repositoryKey: repository.repositoryKey,
      };
      const enforceDiscoveryRateLimit =
        dependencies.enforceDiscoveryRateLimit ?? enforceWebDiscoveryRateLimit;
      await enforceDiscoveryRateLimit(rateLimitInput);
      signal.throwIfAborted();

      const sourceConfig = dependencies.sourceConfig ?? getWebSourceConfig();
      const resolveSource =
        dependencies.resolveSource ?? resolvePublicGitHubSource;
      const resolvedSource = await resolveSource(
        repository.repository,
        "HEAD",
        dependencies.fetchImplementation,
        signal
      );
      const loadTree = dependencies.loadTree ?? loadGitHubRepositoryTree;
      const treeEntries = await loadTree(
        repository.repository,
        resolvedSource.commitSha,
        sourceConfig.limits.maxRawEntries,
        dependencies.fetchImplementation,
        signal
      );
      const projects = discoverGitHubProjectCandidates(treeEntries);
      const projectSelection = resolveProjectSelection(projects, repository);
      if (typeof projectSelection !== "string") {
        return projectSelection;
      }
      const projectPath = projectSelection;

      const cacheConfig = dependencies.cacheConfig ?? getScanCacheConfig();
      const cacheIdentity: ScanCacheIdentity = {
        commitSha: resolvedSource.commitSha,
        projectPath,
        repositoryKey: repository.repositoryKey,
      };
      const readCache = dependencies.readCache ?? readScanCacheFailOpen;
      const cachedResult = await readCache(cacheConfig, cacheIdentity);
      if (cachedResult?.scan.resolvedRevision === resolvedSource.commitSha) {
        return WebScanCompleteStateSchema.parse({
          projectPath,
          repository: repository.repository,
          repositoryUrl: repository.repositoryUrl,
          result: cachedResult,
          status: "complete",
        });
      }

      const asyncConfig = dependencies.asyncConfig ?? getWebAsyncConfig();
      const classifyWorkload =
        dependencies.classifyWorkload ?? classifyWebScanWorkload;
      const workload = classifyWorkload(
        treeEntries,
        projectPath,
        sourceConfig.limits,
        asyncConfig
      );
      const enforceRateLimit =
        dependencies.enforceRateLimit ?? enforceWebScanRateLimit;
      await enforceAsyncScanRateLimit(
        workload.kind === "async",
        enforceRateLimit,
        rateLimitInput,
        signal
      );

      const executeSynchronously = (): Promise<HostedScanResponse> => {
        const admissionController =
          dependencies.admissionController ?? hostedScanAdmissionController;
        return admissionController.run(async () => {
          await enforceRateLimit(rateLimitInput);
          signal.throwIfAborted();
          const request = GitHubScanRequestSchema.parse({
            source: {
              kind: "github",
              repository: repository.repository,
              revision: "HEAD",
              subdirectory: projectPath,
            },
          });
          const materializeSource =
            dependencies.materializeSource ?? materializeResolvedGitHubSource;
          const source = await materializeSource(
            request,
            resolvedSource,
            dependencies.fetchImplementation,
            signal,
            {
              limits: sourceConfig.limits,
              sourceMode: sourceConfig.mode,
              treeEntries,
            }
          );
          signal.throwIfAborted();
          const runScan = dependencies.runScan ?? runHostedScan;
          const result = HostedScanResponseSchema.parse(
            await runScan(source, signal)
          );
          signal.throwIfAborted();
          const writeCache = dependencies.writeCache ?? writeScanCacheFailOpen;
          await writeCache(cacheConfig, cacheIdentity, result);
          return result;
        });
      };
      const dispatcher =
        workload.kind === "async"
          ? (dependencies.asyncDispatcher ?? new VercelQueueScanDispatcher())
          : (dependencies.synchronousDispatcher ??
            new SynchronousScanDispatcher());
      const dispatched = await dispatcher.dispatch({
        asyncConfig,
        cacheIdentity,
        commitSha: resolvedSource.commitSha,
        executeSynchronously,
        projectPath,
        repository: repository.repository,
      });
      if (dispatched.kind === "queued") {
        return WebScanQueuedStateSchema.parse({
          jobId: dispatched.jobId,
          jobToken: dispatched.jobToken,
          pollAfterMs: dispatched.pollAfterMs,
          projectPath,
          repository: repository.repository,
          repositoryInput: repository.repositoryInput,
          repositoryUrl: repository.repositoryUrl,
          status: "queued",
        });
      }

      return WebScanCompleteStateSchema.parse({
        projectPath,
        repository: repository.repository,
        repositoryUrl: repository.repositoryUrl,
        result: dispatched.result,
        status: "complete",
      });
    }, dependencies.deadlineMs);
  } catch (error) {
    throw asWebScanServiceError(error);
  }
};

export type {
  ExecuteWebRepositoryScanDependencies,
  ExecuteWebRepositoryScanInput,
  WebRepositoryScanResult,
};
export { executeWebRepositoryScan };
