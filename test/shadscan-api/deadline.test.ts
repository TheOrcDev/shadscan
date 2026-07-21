import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_SCAN_DEADLINE_MS,
  runWithHostedScanDeadline,
} from "../../lib/shadscan-api/deadline";

afterEach(() => {
  vi.useRealTimers();
});

describe("runWithHostedScanDeadline", () => {
  it("aborts unfinished work with a stable retryable timeout", async () => {
    vi.useFakeTimers();
    let operationSignal: AbortSignal | undefined;
    const outcome = runWithHostedScanDeadline((signal) => {
      operationSignal = signal;
      return new Promise<never>(() => undefined);
    }, 100).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(100);
    const error = await outcome;

    expect(error).toMatchObject({
      code: "SCAN_TIMEOUT",
      retryable: true,
      status: 504,
    });
    expect(operationSignal?.aborted).toBe(true);
    expect(operationSignal?.reason).toBe(error);
  });

  it("clears its timer when work completes", async () => {
    vi.useFakeTimers();

    await expect(
      runWithHostedScanDeadline(() => Promise.resolve("complete"), 100)
    ).resolves.toBe("complete");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves platform time to serialize a response", () => {
    expect(HOSTED_SCAN_DEADLINE_MS).toBe(25_000);
    expect(HOSTED_SCAN_DEADLINE_MS).toBeLessThan(30_000);
  });
});
