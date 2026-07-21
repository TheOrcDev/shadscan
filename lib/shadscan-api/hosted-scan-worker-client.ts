import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { AGENT_PROMPT_VERSION, AuditReportSchema } from "@shadscan/cli";
import { z } from "zod";
import type { MaterializedScanSource } from "./contracts";
import { HostedScanError } from "./errors";

const HOSTED_SCAN_WORKER_RELATIVE_PATH =
  "lib/shadscan-api/hosted-scan-worker.mjs";
const SHADSCAN_CLI_RUNTIME_RELATIVE_PATH = "packages/cli/dist/index.js";
const HOSTED_SCAN_WORKER_RESOURCE_LIMITS = {
  codeRangeSizeMb: 32,
  maxOldGenerationSizeMb: 192,
  maxYoungGenerationSizeMb: 32,
  stackSizeMb: 4,
} as const;

const HostedScanWorkerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      promptMarkdown: z.string().min(1),
      promptVersion: z.literal(AGENT_PROMPT_VERSION),
      report: AuditReportSchema,
      type: z.literal("completed"),
    })
    .strict(),
  z
    .object({
      error: z
        .object({
          kind: z.enum(["PROJECT_DISCOVERY_FAILED", "SCAN_FAILED"]),
          message: z.string(),
          name: z.string(),
        })
        .strict(),
      type: z.literal("failed"),
    })
    .strict(),
]);

type HostedScanWorkerMessage = z.infer<typeof HostedScanWorkerMessageSchema>;
type CompletedHostedScanWorkerMessage = Extract<
  HostedScanWorkerMessage,
  { type: "completed" }
>;

const createWorkerFailure = (
  message: string,
  cause?: unknown
): HostedScanError =>
  new HostedScanError(message, {
    cause,
    code: "SCAN_WORKER_FAILED",
    retryable: true,
    status: 500,
  });

const createWorkerReportedError = (
  message: Extract<HostedScanWorkerMessage, { type: "failed" }>
): HostedScanError => {
  const cause = new Error(message.error.message);
  cause.name = message.error.name;

  if (message.error.kind === "PROJECT_DISCOVERY_FAILED") {
    return new HostedScanError(
      "The selected source is not a supported React project.",
      {
        cause,
        code: "PROJECT_DISCOVERY_FAILED",
        status: 422,
      }
    );
  }

  return createWorkerFailure(
    "The isolated scanner could not complete the audit.",
    cause
  );
};

const getAbortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The scan was aborted.", "AbortError");

type HostedScanWorkerEvent =
  | { error: Error; type: "error" }
  | { error: Error; type: "messageerror" }
  | { exitCode: number; type: "exit" }
  | { type: "aborted" }
  | { type: "message"; value: unknown };

const terminateWorker = async (worker: Worker): Promise<void> => {
  await worker.terminate();
};

const runHostedScanWorker = async (
  source: MaterializedScanSource,
  signal?: AbortSignal
): Promise<CompletedHostedScanWorkerMessage> => {
  signal?.throwIfAborted();

  const workerPath = pathToFileURL(
    path.resolve(process.cwd(), HOSTED_SCAN_WORKER_RELATIVE_PATH)
  );
  const cliModuleUrl = pathToFileURL(
    path.resolve(process.cwd(), SHADSCAN_CLI_RUNTIME_RELATIVE_PATH)
  ).href;
  let worker: Worker;
  try {
    worker = new Worker(workerPath, {
      argv: [],
      env: { NODE_ENV: process.env.NODE_ENV },
      execArgv: [],
      name: "shadscan-hosted-scan",
      resourceLimits: HOSTED_SCAN_WORKER_RESOURCE_LIMITS,
      trackUnmanagedFds: true,
      workerData: {
        cliModuleUrl,
        input: {
          category: source.category,
          filesystemRoot: source.sourceRoot,
          projectRoot: source.projectRoot,
          source: {
            digest: source.sourceDigest,
            kind: source.sourceKind,
            revision: source.resolvedRevision,
          },
        },
        operation: "scan",
      },
    });
  } catch (error) {
    throw createWorkerFailure(
      "The scanner worker could not be started.",
      error
    );
  }

  let resolveWorkerEvent: (event: HostedScanWorkerEvent) => void = () =>
    undefined;
  const workerEvent = new Promise<HostedScanWorkerEvent>((resolve) => {
    resolveWorkerEvent = resolve;
  });
  const handleAbort = (): void => resolveWorkerEvent({ type: "aborted" });
  const handleError = (error: Error): void =>
    resolveWorkerEvent({ error, type: "error" });
  const handleExit = (exitCode: number): void =>
    resolveWorkerEvent({ exitCode, type: "exit" });
  const handleMessage = (value: unknown): void =>
    resolveWorkerEvent({ type: "message", value });
  const handleMessageError = (error: Error): void =>
    resolveWorkerEvent({ error, type: "messageerror" });

  worker.once("error", handleError);
  worker.once("exit", handleExit);
  worker.once("message", handleMessage);
  worker.once("messageerror", handleMessageError);
  signal?.addEventListener("abort", handleAbort, { once: true });
  if (signal?.aborted) {
    handleAbort();
  }

  try {
    const event = await workerEvent;

    if (event.type === "aborted") {
      await terminateWorker(worker);
      throw signal
        ? getAbortReason(signal)
        : createWorkerFailure("The scanner worker was aborted unexpectedly.");
    }

    if (event.type === "error") {
      throw createWorkerFailure(
        "The scanner worker stopped unexpectedly.",
        event.error
      );
    }

    if (event.type === "messageerror") {
      await terminateWorker(worker);
      throw createWorkerFailure(
        "The scanner worker response could not be decoded.",
        event.error
      );
    }

    if (event.type === "exit") {
      const message =
        event.exitCode === 0
          ? "The scanner worker exited without returning a result."
          : `The scanner worker exited with status ${event.exitCode}.`;
      throw createWorkerFailure(message);
    }

    await terminateWorker(worker);
    const result = HostedScanWorkerMessageSchema.safeParse(event.value);
    if (!result.success) {
      throw createWorkerFailure(
        "The scanner worker returned an invalid response.",
        result.error
      );
    }
    if (result.data.type === "failed") {
      throw createWorkerReportedError(result.data);
    }
    return result.data;
  } finally {
    worker.off("error", handleError);
    worker.off("exit", handleExit);
    worker.off("message", handleMessage);
    worker.off("messageerror", handleMessageError);
    signal?.removeEventListener("abort", handleAbort);
  }
};

export {
  HOSTED_SCAN_WORKER_RELATIVE_PATH,
  HOSTED_SCAN_WORKER_RESOURCE_LIMITS,
  runHostedScanWorker,
  SHADSCAN_CLI_RUNTIME_RELATIVE_PATH,
};
