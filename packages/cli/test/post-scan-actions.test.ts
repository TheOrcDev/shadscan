import { describe, expect, it, vi } from "vitest";
import type { DiscoveredAgentCli } from "../src/agent-cli";
import {
  createPostScanMenu,
  parseMenuSelection,
  promptPostScanAction,
  resolveInteractiveMode,
} from "../src/post-scan-actions";

const CODEX_AGENT: DiscoveredAgentCli = {
  agentId: "codex",
  executablePath: "/opt/bin/codex",
  label: "Codex CLI",
  version: "codex 1.0.0",
};

describe("post-scan actions", () => {
  it("requires an explicitly enabled local TTY session", () => {
    const interactive = resolveInteractiveMode({
      enabled: true,
      environment: {},
      terminal: {
        errorIsTTY: true,
        inputIsTTY: true,
        outputIsTTY: true,
      },
    });

    expect(interactive).toBe(true);
    expect(
      resolveInteractiveMode({
        enabled: true,
        environment: { CI: "1" },
        terminal: {
          errorIsTTY: true,
          inputIsTTY: true,
          outputIsTTY: true,
        },
      })
    ).toBe(false);
    expect(
      resolveInteractiveMode({
        enabled: true,
        environment: { SHADSCAN_INTERACTIVE: "0" },
        terminal: {
          errorIsTTY: true,
          inputIsTTY: true,
          outputIsTTY: true,
        },
      })
    ).toBe(false);
    expect(
      resolveInteractiveMode({
        enabled: true,
        environment: {},
        terminal: {
          errorIsTTY: true,
          inputIsTTY: false,
          outputIsTTY: true,
        },
      })
    ).toBe(false);
  });

  it("puts Done last and uses it for an empty answer", () => {
    const options = createPostScanMenu({
      agents: [CODEX_AGENT],
      includePreCommit: true,
    });

    expect(options.map((option) => option.action.kind)).toEqual([
      "agent",
      "pre-commit",
      "done",
    ]);
    expect(parseMenuSelection({ answer: "", options })).toEqual({
      kind: "done",
    });
    expect(parseMenuSelection({ answer: "1", options })).toEqual({
      agentId: "codex",
      kind: "agent",
    });
    expect(parseMenuSelection({ answer: "99", options })).toBeNull();
  });

  it("does not show an external-agent warning for a hook-only menu", async () => {
    const write = vi.fn<(message: string) => void>();

    const action = await promptPostScanAction({
      agents: [],
      ask: async () => "",
      includePreCommit: true,
      write,
    });

    expect(action).toEqual({ kind: "done" });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("What next?"));
    expect(write).not.toHaveBeenCalledWith(
      expect.stringContaining("External agents may read and edit files")
    );
  });

  it("prompts again after an invalid selection without mutating anything", async () => {
    const ask = vi
      .fn<(prompt: string) => Promise<string>>()
      .mockResolvedValueOnce("nope")
      .mockResolvedValueOnce("2");
    const write = vi.fn<(message: string) => void>();

    const action = await promptPostScanAction({
      agents: [CODEX_AGENT],
      ask,
      includePreCommit: false,
      write,
    });

    expect(action).toEqual({ kind: "done" });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("External agents may read and edit files")
    );
    expect(write).toHaveBeenCalledWith("Choose one of the numbered options.\n");
  });
});
