import { HostedScanError } from "./errors";

const HOSTED_SCAN_DEADLINE_MS = 25_000;

const createHostedScanTimeoutError = (): HostedScanError =>
  new HostedScanError("The scan exceeded the hosted execution deadline.", {
    code: "SCAN_TIMEOUT",
    retryable: true,
    status: 504,
  });

const runWithHostedScanDeadline = async <Result>(
  operation: (signal: AbortSignal) => Promise<Result>,
  timeoutMs = HOSTED_SCAN_DEADLINE_MS
): Promise<Result> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("The hosted scan deadline must be a positive integer.");
  }

  const controller = new AbortController();
  const timeoutError = createHostedScanTimeoutError();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout,
    ]);
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
};

export {
  createHostedScanTimeoutError,
  HOSTED_SCAN_DEADLINE_MS,
  runWithHostedScanDeadline,
};
