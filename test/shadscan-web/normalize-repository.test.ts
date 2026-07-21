import { describe, expect, it } from "vitest";
import { normalizeGitHubRepository } from "../../lib/shadscan-web/normalize-repository";

describe("normalizeGitHubRepository", () => {
  it.each([
    ["TheOrcDev/headless-shadcn", "TheOrcDev/headless-shadcn"],
    [
      "https://github.com/TheOrcDev/headless-shadcn",
      "TheOrcDev/headless-shadcn",
    ],
    [
      "https://github.com/TheOrcDev/headless-shadcn/",
      "TheOrcDev/headless-shadcn",
    ],
    [
      "https://github.com/TheOrcDev/headless-shadcn.git",
      "TheOrcDev/headless-shadcn",
    ],
    ["  TheOrcDev/headless-shadcn.git  ", "TheOrcDev/headless-shadcn"],
  ])("normalizes %s", (input, expectedRepository) => {
    expect(normalizeGitHubRepository(input)).toEqual({
      repository: expectedRepository,
      repositoryInput: input.trim(),
      repositoryKey: expectedRepository.toLowerCase(),
      repositoryUrl: `https://github.com/${expectedRepository}`,
    });
  });

  it("keeps a validated project path separate from the repository URL", () => {
    expect(
      normalizeGitHubRepository(
        "https://github.com/TheOrcDev/headless-shadcn",
        "apps/web"
      )
    ).toMatchObject({
      projectPath: "apps/web",
      repository: "TheOrcDev/headless-shadcn",
    });
  });

  it.each([
    "../apps/web",
    "/apps/web",
    "apps\\web",
    "apps//web",
  ])("rejects an unsafe project path: %s", (projectPath) => {
    expect(() =>
      normalizeGitHubRepository("TheOrcDev/headless-shadcn", projectPath)
    ).toThrow(
      expect.objectContaining({
        code: "INVALID_PROJECT_PATH",
      })
    );
  });

  it.each([
    "",
    "github.com/TheOrcDev/headless-shadcn",
    "http://github.com/TheOrcDev/headless-shadcn",
    "https://gitlab.com/TheOrcDev/headless-shadcn",
    "https://user:pass@github.com/TheOrcDev/headless-shadcn",
    "https://github.com:444/TheOrcDev/headless-shadcn",
    "https://github.com/TheOrcDev/headless-shadcn?tab=readme",
    "https://github.com/TheOrcDev/headless-shadcn#readme",
    "https://github.com/TheOrcDev/headless-shadcn/tree/main",
    "https://github.com/TheOrcDev/%68eadless-shadcn",
    "TheOrcDev/headless-shadcn/extra",
    "The OrcDev/headless-shadcn",
    "../headless-shadcn",
  ])("rejects unsupported input: %s", (input) => {
    expect(() => normalizeGitHubRepository(input)).toThrowError(
      expect.objectContaining({
        code: "INVALID_REPOSITORY",
      })
    );
  });
});
