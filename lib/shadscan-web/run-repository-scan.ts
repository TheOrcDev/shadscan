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
import {
  type FetchImplementation,
  materializeGitHubSource,
} from "../shadscan-api/github-source";
import { runHostedScan } from "../shadscan-api/run-hosted-scan";
import { WebScanCompleteStateSchema } from "./contracts";
import { asWebScanServiceError } from "./errors";
import { normalizeGitHubRepository } from "./normalize-repository";
import { enforceWebScanRateLimit, type WebRateLimitInput } from "./rate-limit";
import { getWebSourceConfig, type WebSourceConfig } from "./source-config";
import type { WebScanCompleteState } from "./types";

interface ExecuteWebRepositoryScanInput {
  clientAddress: string;
  repositoryInput: unknown;
}

interface ExecuteWebRepositoryScanDependencies {
  admissionController?: HostedScanAdmissionController;
  deadlineMs?: number;
  enforceRateLimit?: (input: WebRateLimitInput) => Promise<unknown> | unknown;
  fetchImplementation?: FetchImplementation;
  materializeSource?: typeof materializeGitHubSource;
  runScan?: (
    source: Parameters<typeof runHostedScan>[0],
    signal?: AbortSignal
  ) => HostedScanResponse | Promise<HostedScanResponse>;
  sourceConfig?: WebSourceConfig;
}

const executeWebRepositoryScan = async (
  input: ExecuteWebRepositoryScanInput,
  dependencies: ExecuteWebRepositoryScanDependencies = {}
): Promise<WebScanCompleteState> => {
  try {
    return await runWithHostedScanDeadline(async (signal) => {
      const repository = normalizeGitHubRepository(input.repositoryInput);
      const admissionController =
        dependencies.admissionController ?? hostedScanAdmissionController;
      return await admissionController.run(async () => {
        const enforceRateLimit =
          dependencies.enforceRateLimit ?? enforceWebScanRateLimit;
        await enforceRateLimit({
          clientAddress: input.clientAddress,
          repositoryKey: repository.repositoryKey,
        });
        signal.throwIfAborted();

        const request = GitHubScanRequestSchema.parse({
          source: {
            kind: "github",
            repository: repository.repository,
            revision: "HEAD",
            subdirectory: ".",
          },
        });
        const materializeSource =
          dependencies.materializeSource ?? materializeGitHubSource;
        const sourceConfig = dependencies.sourceConfig ?? getWebSourceConfig();
        const source = await materializeSource(
          request,
          dependencies.fetchImplementation,
          signal,
          sourceConfig.limits
        );
        signal.throwIfAborted();
        const runScan = dependencies.runScan ?? runHostedScan;
        const result = HostedScanResponseSchema.parse(
          await runScan(source, signal)
        );
        signal.throwIfAborted();

        return WebScanCompleteStateSchema.parse({
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
};
export { executeWebRepositoryScan };
