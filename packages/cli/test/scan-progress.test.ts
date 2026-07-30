import { afterEach, describe, expect, it, vi } from "vitest";
import { createScanProgress } from "../src/scan-progress";

const CLEAR_ACTIVE_LINE = "\r\u001B[2K";

const createOutput = (): {
  messages: string[];
  write: (message: string) => boolean;
} => {
  const messages: string[] = [];

  return {
    messages,
    write: (message: string): boolean => {
      messages.push(message);
      return true;
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("scan progress", () => {
  it("renders immediately, animates, and leaves a persistent success line", async () => {
    vi.useFakeTimers();
    const output = createOutput();
    const progress = createScanProgress({
      enabled: true,
      intervalMs: 50,
      output,
      terminal: { color: false, columns: 80, unicode: true },
    });

    const resultPromise = progress.run(
      "Evaluating UI rules",
      async () =>
        await new Promise<string>((resolve) => {
          setTimeout(() => resolve("report"), 120);
        })
    );

    expect(output.messages).toEqual([
      `${CLEAR_ACTIVE_LINE}⠋ Evaluating UI rules`,
    ]);

    await vi.advanceTimersByTimeAsync(50);
    expect(output.messages.at(-1)).toBe(
      `${CLEAR_ACTIVE_LINE}⠙ Evaluating UI rules`
    );

    await vi.advanceTimersByTimeAsync(70);
    await expect(resultPromise).resolves.toBe("report");
    expect(output.messages.at(-1)).toBe(
      `${CLEAR_ACTIVE_LINE}✓ Evaluating UI rules\n`
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("marks the failed phase, cleans up, and rethrows the same error", async () => {
    vi.useFakeTimers();
    const output = createOutput();
    const progress = createScanProgress({
      enabled: true,
      output,
      terminal: { color: false, columns: 80, unicode: true },
    });
    const failure = new Error("private detail");

    await expect(
      progress.run("Discovering app structure", () => {
        throw failure;
      })
    ).rejects.toBe(failure);

    expect(output.messages.at(-1)).toBe(
      `${CLEAR_ACTIVE_LINE}✗ Discovering app structure\n\n`
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses ASCII symbols when Unicode is unavailable", async () => {
    const output = createOutput();
    const progress = createScanProgress({
      enabled: true,
      output,
      terminal: { color: false, columns: 80, unicode: false },
    });

    await progress.run("Resolving project", () => "project");
    progress.finish();

    expect(output.messages).toEqual([
      `${CLEAR_ACTIVE_LINE}- Resolving project`,
      `${CLEAR_ACTIVE_LINE}[ok] Resolving project\n`,
      "\n",
    ]);
  });

  it("colors active and completed symbols when color is available", async () => {
    const output = createOutput();
    const progress = createScanProgress({
      enabled: true,
      output,
      terminal: { color: true, columns: 80, unicode: true },
    });

    await progress.run("Resolving project", () => "project");

    expect(output.messages[0]).toContain("\u001B[36m⠋\u001B[39m");
    expect(output.messages[1]).toContain("\u001B[32m✓\u001B[39m");
  });

  it("unrefs the animation timer and clears it after completion", async () => {
    const output = createOutput();
    const timer = setInterval(() => undefined, 10_000);
    const unref = vi.spyOn(timer, "unref");
    const clearTimer = vi.spyOn(globalThis, "clearInterval");
    vi.spyOn(globalThis, "setInterval").mockReturnValue(timer);
    let resolveTask: ((value: number) => void) | undefined;
    const task = new Promise<number>((resolve) => {
      resolveTask = resolve;
    });
    const progress = createScanProgress({
      enabled: true,
      output,
      terminal: { color: false, columns: 80, unicode: true },
    });

    const result = progress.run("Evaluating UI rules", () => task);
    expect(unref).toHaveBeenCalledOnce();

    resolveTask?.(42);
    await expect(result).resolves.toBe(42);
    expect(clearTimer).toHaveBeenCalledWith(timer);
  });

  it("executes disabled phases without writing or starting timers", async () => {
    vi.useFakeTimers();
    const output = createOutput();
    const progress = createScanProgress({
      enabled: false,
      output,
      terminal: { color: true, columns: 80, unicode: true },
    });

    await expect(progress.run("Resolving project", () => 42)).resolves.toBe(42);
    progress.finish();

    expect(output.messages).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not turn an output failure into a scan failure", async () => {
    vi.useFakeTimers();
    const progress = createScanProgress({
      enabled: true,
      output: {
        write: () => {
          throw new Error("stderr unavailable");
        },
      },
      terminal: { color: false, columns: 80, unicode: true },
    });

    await expect(progress.run("Resolving project", () => 42)).resolves.toBe(42);
    progress.finish();

    expect(vi.getTimerCount()).toBe(0);
  });
});
