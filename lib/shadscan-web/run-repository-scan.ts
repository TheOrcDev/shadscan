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
import {
  WebProjectSelectionStateSchema,
  WebScanCompleteStateSchema,
} from "./contracts";
import { enforceWebDiscoveryRateLimit } from "./discovery-rate-limit";
import { asWebScanServiceError } from "./errors";
import { normalizeGitHubRepository } from "./normalize-repository";
import { enforceWebScanRateLimit, type WebRateLimitInput } from "./rate-limit";
import { getWebSourceConfig, type WebSourceConfig } from "./source-config";
import type {
  WebProjectOption,
  WebProjectSelectionState,
  WebScanCompleteState,
} from "./types";

interface ExecuteWebRepositoryScanInput {
  clientAddress: string;
  projectPath?: unknown;
  repositoryInput: unknown;
}

interface ExecuteWebRepositoryScanDependencies {
  admissionController?: HostedScanAdmissionController;
  deadlineMs?: number;
  enforceDiscoveryRateLimit?: (
    input: WebRateLimitInput
  ) => Promise<unknown> | unknown;
  enforceRateLimit?: (input: WebRateLimitInput) => Promise<unknown> | unknown;
  fetchImplementation?: FetchImplementation;
  loadTree?: typeof loadGitHubRepositoryTree;
  materializeSource?: typeof materializeResolvedGitHubSource;
  resolveSource?: typeof resolvePublicGitHubSource;
  runScan?: (
    source: Parameters<typeof runHostedScan>[0],
    signal?: AbortSignal
  ) => HostedScanResponse | Promise<HostedScanResponse>;
  sourceConfig?: WebSourceConfig;
}

type WebRepositoryScanResult = WebProjectSelectionState | WebScanCompleteState;

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
      const admissionController =
        dependencies.admissionController ?? hostedScanAdmissionController;
      return await admissionController.run(async () => {
        const rateLimitInput = {
          clientAddress: input.clientAddress,
          repositoryKey: repository.repositoryKey,
        };
        const enforceDiscoveryRateLimit =
          dependencies.enforceDiscoveryRateLimit ??
          enforceWebDiscoveryRateLimit;
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
        if (projects.length === 0) {
          throw new HostedScanError(
            "No supported React project was found in the repository.",
            {
              code: "PROJECT_ROOT_NOT_FOUND",
              status: 422,
            }
          );
        }
        const projectPath = selectProjectPath(projects, repository.projectPath);
        if (!projectPath) {
          return WebProjectSelectionStateSchema.parse({
            projects,
            repository: repository.repository,
            repositoryInput: repository.repositoryInput,
            repositoryUrl: repository.repositoryUrl,
            status: "project_selection_required",
          });
        }

        const enforceRateLimit =
          dependencies.enforceRateLimit ?? enforceWebScanRateLimit;
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

        return WebScanCompleteStateSchema.parse({
          projectPath,
          repository: repository.repository,
          repositoryUrl: repository.repositoryUrl,
          result,
          status: "complete",
        });
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
