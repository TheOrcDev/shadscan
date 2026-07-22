import { describe, expect, it, vi } from "vitest";
import {
  copyToClipboard,
  getClipboardCommands,
  MAX_OSC52_TEXT_BYTES,
} from "../src/clipboard";

type CloseListener = (code: number | null) => void;
type ErrorListener = (error: Error) => void;

const createFakeChild = (outcome: "error" | number) => {
  const listeners = new Map<string, CloseListener | ErrorListener>();
  const child = {
    once(event: string, listener: CloseListener | ErrorListener) {
      listeners.set(event, listener);
      queueMicrotask(() => {
        if (outcome === "error" && event === "error") {
          (listener as ErrorListener)(new Error("spawn failed"));
        }
        if (outcome !== "error" && event === "close") {
          (listener as CloseListener)(outcome);
        }
      });
      return child;
    },
    stdin: {
      end: vi.fn(),
      once: vi.fn(),
    },
  };
  return child;
};

const createFakeSpawn = (outcomes: ("error" | number)[]) => {
  const calls: { args: string[]; command: string }[] = [];
  const spawn = vi.fn((command: string, args: string[]) => {
    calls.push({ args, command });
    return createFakeChild(outcomes[calls.length - 1] ?? "error");
  });
  return { calls, spawn };
};

describe("clipboard", () => {
  it("selects platform-appropriate utilities", () => {
    expect(getClipboardCommands("darwin").map((c) => c.command)).toEqual([
      "pbcopy",
    ]);
    expect(getClipboardCommands("win32").map((c) => c.command)).toEqual([
      "clip",
    ]);
    expect(getClipboardCommands("linux").map((c) => c.command)).toEqual([
      "wl-copy",
      "xclip",
      "xsel",
    ]);
  });

  it("copies through the first working utility and pipes the exact text", async () => {
    const { calls, spawn } = createFakeSpawn([0]);

    const result = await copyToClipboard("handoff text", {
      platform: "darwin",
      spawnImplementation: spawn as never,
    });

    expect(result).toEqual({ copied: true, method: "utility" });
    expect(calls).toEqual([{ args: [], command: "pbcopy" }]);
    expect(spawn.mock.results[0]?.value.stdin.end).toHaveBeenCalledWith(
      "handoff text"
    );
  });

  it("falls through failing utilities in order", async () => {
    const { calls, spawn } = createFakeSpawn(["error", 1, 0]);

    const result = await copyToClipboard("text", {
      platform: "linux",
      spawnImplementation: spawn as never,
    });

    expect(result).toEqual({ copied: true, method: "utility" });
    expect(calls.map((call) => call.command)).toEqual([
      "wl-copy",
      "xclip",
      "xsel",
    ]);
  });

  it("falls back to OSC 52 when utilities are unavailable", async () => {
    const { spawn } = createFakeSpawn(["error"]);
    const writes: string[] = [];

    const result = await copyToClipboard("plan", {
      osc52Write: (sequence) => writes.push(sequence),
      platform: "darwin",
      spawnImplementation: spawn as never,
    });

    expect(result).toEqual({ copied: true, method: "osc52" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe(
      `\u001b]52;c;${Buffer.from("plan", "utf8").toString("base64")}\u0007`
    );
  });

  it("refuses OSC 52 beyond the size cap and reports failure honestly", async () => {
    const { spawn } = createFakeSpawn(["error"]);
    const writes: string[] = [];
    const oversized = "x".repeat(MAX_OSC52_TEXT_BYTES + 1);

    const result = await copyToClipboard(oversized, {
      osc52Write: (sequence) => writes.push(sequence),
      platform: "darwin",
      spawnImplementation: spawn as never,
    });

    expect(result).toEqual({ copied: false, method: null });
    expect(writes).toHaveLength(0);
  });

  it("returns an honest failure without an OSC 52 channel", async () => {
    const { spawn } = createFakeSpawn(["error"]);

    const result = await copyToClipboard("text", {
      platform: "darwin",
      spawnImplementation: spawn as never,
    });

    expect(result).toEqual({ copied: false, method: null });
  });
});
