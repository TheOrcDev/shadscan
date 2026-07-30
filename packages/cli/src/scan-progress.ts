import picocolors from "picocolors";
import type { TerminalCapabilities } from "./terminal-capabilities";

interface ScanProgressOutput {
  write: (message: string) => unknown;
}

interface CreateScanProgressOptions {
  enabled: boolean;
  intervalMs?: number;
  output: ScanProgressOutput;
  terminal: TerminalCapabilities;
}

interface ScanProgress {
  finish: () => void;
  run: <Result>(
    label: string,
    task: () => Promise<Result> | Result
  ) => Promise<Result>;
}

const CLEAR_ACTIVE_LINE = "\r\u001B[2K";
const DEFAULT_INTERVAL_MS = 80;
const ASCII_FRAMES = ["-", "\\", "|", "/"] as const;
const UNICODE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"] as const;

class TerminalScanProgress implements ScanProgress {
  private activeLabel: string | null = null;
  private frameIndex = 0;
  private hasRendered = false;
  private readonly options: CreateScanProgressOptions;
  private outputHealthy = true;
  private separated = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CreateScanProgressOptions) {
    this.options = options;
  }

  finish = (): void => {
    const canSeparate =
      this.options.enabled &&
      this.hasRendered &&
      !this.separated &&
      this.activeLabel === null;

    if (!canSeparate) {
      return;
    }

    this.separated = true;
    this.write("\n");
  };

  run = async <Result>(
    label: string,
    task: () => Promise<Result> | Result
  ): Promise<Result> => {
    if (!this.options.enabled) {
      return await task();
    }

    this.start(label);

    try {
      const result = await task();
      this.complete(label);
      return result;
    } catch (error) {
      this.fail(label);
      throw error;
    }
  };

  private readonly complete = (label: string): void => {
    this.stopTimer();
    this.activeLabel = null;
    const colors = picocolors.createColors(this.options.terminal.color);
    const symbol = this.options.terminal.unicode ? "✓" : "[ok]";
    this.write(`${CLEAR_ACTIVE_LINE}${colors.green(symbol)} ${label}\n`);
  };

  private readonly fail = (label: string): void => {
    this.stopTimer();
    this.activeLabel = null;
    const colors = picocolors.createColors(this.options.terminal.color);
    const symbol = this.options.terminal.unicode ? "✗" : "[x]";
    this.write(`${CLEAR_ACTIVE_LINE}${colors.red(symbol)} ${label}\n\n`);
    this.separated = true;
  };

  private readonly renderActive = (): void => {
    const frames = this.options.terminal.unicode
      ? UNICODE_FRAMES
      : ASCII_FRAMES;
    const frame = frames[this.frameIndex % frames.length];
    const colors = picocolors.createColors(this.options.terminal.color);
    this.frameIndex += 1;
    this.hasRendered = true;
    this.write(
      `${CLEAR_ACTIVE_LINE}${colors.cyan(frame)} ${this.activeLabel ?? ""}`
    );
  };

  private readonly start = (label: string): void => {
    this.activeLabel = label;
    this.frameIndex = 0;
    this.renderActive();

    if (!this.outputHealthy) {
      return;
    }

    this.timer = setInterval(
      this.renderActive,
      this.options.intervalMs ?? DEFAULT_INTERVAL_MS
    );
    this.timer.unref?.();
  };

  private readonly stopTimer = (): void => {
    if (this.timer === null) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  };

  private readonly write = (message: string): void => {
    if (!this.outputHealthy) {
      return;
    }

    try {
      this.options.output.write(message);
    } catch {
      this.outputHealthy = false;
      this.stopTimer();
    }
  };
}

const createScanProgress = (options: CreateScanProgressOptions): ScanProgress =>
  new TerminalScanProgress(options);

export type { CreateScanProgressOptions, ScanProgress, ScanProgressOutput };
export { createScanProgress };
