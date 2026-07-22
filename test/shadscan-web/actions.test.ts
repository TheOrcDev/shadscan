import { beforeEach, describe, expect, it, vi } from "vitest";
import { HostedScanError } from "../../lib/shadscan-api/errors";

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
  projectPath: ".",
  repository: "acme/widget",
  repositoryUrl: "https://github.com/acme/widget",
  result: {
    report: {
      agentHandoff: { workItems: [] },
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
      projectPath: undefined,
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
      projectPath: undefined,
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

  it("returns project selection without logging a completed scan", async () => {
    const selection = {
      projects: [
        { label: "apps/admin", path: "apps/admin" },
        { label: "apps/store", path: "apps/store" },
      ],
      repository: "acme/monorepo",
      repositoryInput: "acme/monorepo",
      repositoryUrl: "https://github.com/acme/monorepo",
      status: "project_selection_required",
    };
    mocks.executeScan.mockResolvedValue(selection);
    const formData = new FormData();
    formData.set("repository", "acme/monorepo");

    const result = await scanGitHubRepository({ status: "idle" }, formData);

    expect(result).toBe(selection);
    expect(mocks.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "selection_required",
        repository: "acme/monorepo",
      })
    );
  });

  it("logs allowlisted upstream diagnostics without returning them", async () => {
    mocks.executeScan.mockRejectedValue(
      new HostedScanError("Internal upstream detail", {
        code: "GITHUB_INVALID_RESPONSE",
        diagnostics: {
          kind: "upstream_response_too_large",
          limitBytes: 65_536,
          observedBytes: 77_750,
          stage: "resolve_revision",
          upstreamRequestId: "ABCD:1234:EFGH:5678",
          upstreamStatus: 200,
        },
        status: 502,
      })
    );
    const formData = new FormData();
    formData.set("repository", "acme/widget");

    const result = await scanGitHubRepository({ status: "idle" }, formData);

    expect(result).toEqual({
      error: {
        code: "SOURCE_UNSUPPORTED",
        message:
          "GitHub returned source metadata the web scanner could not safely process. Run shadscan locally instead.",
        retryable: false,
      },
      projectPath: undefined,
      repositoryInput: "acme/widget",
      status: "error",
    });
    expect(mocks.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "SOURCE_UNSUPPORTED",
        failureKind: "upstream_response_too_large",
        failureStage: "resolve_revision",
        internalErrorCode: "GITHUB_INVALID_RESPONSE",
        internalStatus: 502,
        limitBytes: 65_536,
        observedBytes: 77_750,
        outcome: "failed",
        upstreamRequestId: "ABCD:1234:EFGH:5678",
        upstreamStatus: 200,
      })
    );
    expect(JSON.stringify(result)).not.toContain("Internal upstream detail");
  });

  it("returns a queued scan without logging it as complete", async () => {
    const queued = {
      jobId: "9e83046c-84aa-4da2-a9ef-ec2b38f7058e",
      jobToken: "a".repeat(64),
      pollAfterMs: 1500,
      projectPath: ".",
      repository: "acme/widget",
      repositoryInput: "acme/widget",
      repositoryUrl: "https://github.com/acme/widget",
      status: "queued",
    };
    mocks.executeScan.mockResolvedValue(queued);
    const formData = new FormData();
    formData.set("repository", "acme/widget");

    const result = await scanGitHubRepository({ status: "idle" }, formData);

    expect(result).toBe(queued);
    expect(mocks.writeLog).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "queued",
        repository: "acme/widget",
      })
    );
  });
});
