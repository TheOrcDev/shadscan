import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeScan: vi.fn(),
  headers: vi.fn(),
  writeLog: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock(
  "@/lib/shadscan-web/contracts",
  () => import("../../lib/shadscan-web/contracts")
);
vi.mock(
  "@/lib/shadscan-web/errors",
  () => import("../../lib/shadscan-web/errors")
);
vi.mock(
  "@/lib/shadscan-web/types",
  () => import("../../lib/shadscan-web/types")
);
vi.mock("@/lib/shadscan-web/log", () => ({
  writeWebScanLog: mocks.writeLog,
}));
vi.mock("@/lib/shadscan-web/run-repository-scan", () => ({
  executeWebRepositoryScan: mocks.executeScan,
}));

const { scanGitHubRepository } = await import("../../app/scan/actions");

const COMPLETED_RESULT = {
  repository: "acme/widget",
  repositoryUrl: "https://github.com/acme/widget",
  result: {
    report: {
      agentHandoff: { actionables: [] },
      score: 92,
    },
    scan: {
      engineVersion: "0.1.0",
      resolvedRevision: "0123456789abcdef0123456789abcdef01234567",
      rulesetVersion: "2026.07.25",
    },
  },
  status: "complete",
};

beforeEach(() => {
  mocks.executeScan.mockReset();
  mocks.headers.mockReset();
  mocks.writeLog.mockReset();
  mocks.headers.mockResolvedValue(
    new Headers({
      "x-forwarded-for": "203.0.113.4, 198.51.100.2",
    })
  );
});

describe("scanGitHubRepository", () => {
  it("uses the first trusted forwarded address and returns the completed scan", async () => {
    mocks.executeScan.mockResolvedValue(COMPLETED_RESULT);
    const formData = new FormData();
    formData.set("repository", "acme/widget");

    const result = await scanGitHubRepository({ status: "idle" }, formData);

    expect(mocks.executeScan).toHaveBeenCalledWith({
      clientAddress: "203.0.113.4",
      repositoryInput: "acme/widget",
    });
    expect(result).toBe(COMPLETED_RESULT);
    expect(mocks.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actionableCount: 0,
        outcome: "completed",
        repository: "acme/widget",
        score: 92,
      })
    );
  });

  it("returns a bounded public error without leaking the internal cause", async () => {
    const internalMessage = "token and temporary path must not escape";
    mocks.executeScan.mockRejectedValue(new Error(internalMessage));
    const repositoryInput = "a".repeat(300);
    const formData = new FormData();
    formData.set("repository", repositoryInput);

    const result = await scanGitHubRepository({ status: "idle" }, formData);

    expect(result).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The scan could not be completed. Try again.",
        retryable: true,
      },
      repositoryInput: repositoryInput.slice(0, 256),
      status: "error",
    });
    expect(mocks.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "INTERNAL_ERROR",
        outcome: "failed",
      })
    );
    expect(JSON.stringify(result)).not.toContain(internalMessage);
  });
});
