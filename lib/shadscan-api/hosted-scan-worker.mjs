import { parentPort, workerData } from "node:worker_threads";

if (parentPort === null) {
  throw new Error("The hosted scan worker requires a parent message port.");
}

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isBaseWorkerData = (value) =>
  isRecord(value) && typeof value.cliModuleUrl === "string";

const isScanWorkerData = (value) =>
  isBaseWorkerData(value) &&
  value.operation === "scan" &&
  isRecord(value.input) &&
  typeof value.input.filesystemRoot === "string" &&
  typeof value.input.projectRoot === "string" &&
  isRecord(value.input.source) &&
  typeof value.input.source.digest === "string" &&
  (value.input.source.kind === "git" ||
    value.input.source.kind === "snapshot") &&
  (value.input.source.revision === null ||
    typeof value.input.source.revision === "string");

const loadScanner = async (moduleUrl) => {
  const scanner = await import(moduleUrl);
  if (
    typeof scanner.AGENT_PROMPT_VERSION !== "number" ||
    typeof scanner.ProjectDiscoveryError !== "function" ||
    typeof scanner.renderAgentPrompt !== "function" ||
    typeof scanner.scanProject !== "function"
  ) {
    throw new Error("The hosted scan worker loaded an invalid scanner module.");
  }
  return scanner;
};

const toWorkerError = (error, ProjectDiscoveryError) => ({
  kind:
    error instanceof ProjectDiscoveryError
      ? "PROJECT_DISCOVERY_FAILED"
      : "SCAN_FAILED",
  message: error instanceof Error ? error.message : "Unknown scanner failure.",
  name: error instanceof Error ? error.name : "Error",
});

const run = async () => {
  if (!isBaseWorkerData(workerData)) {
    throw new Error("The hosted scan worker received invalid input.");
  }

  const scanner = await loadScanner(workerData.cliModuleUrl);
  if (workerData.operation === "healthcheck") {
    parentPort.postMessage({ type: "ready" });
    return;
  }

  if (!isScanWorkerData(workerData)) {
    throw new Error("The hosted scan worker received invalid input.");
  }

  try {
    const report = await scanner.scanProject(workerData.input.projectRoot, {
      category: workerData.input.category,
      filesystemRoot: workerData.input.filesystemRoot,
      source: workerData.input.source,
    });
    const promptMarkdown = scanner.renderAgentPrompt(report);
    parentPort.postMessage({
      promptMarkdown,
      promptVersion: scanner.AGENT_PROMPT_VERSION,
      report,
      type: "completed",
    });
  } catch (error) {
    parentPort.postMessage({
      error: toWorkerError(error, scanner.ProjectDiscoveryError),
      type: "failed",
    });
  }
};

await run();
