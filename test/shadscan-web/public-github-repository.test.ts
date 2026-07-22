import { describe, expect, it, vi } from "vitest";
import {
  fetchGitHubStargazerCount,
  fetchPublicGitHubRepository,
  getConfiguredGitHubRepository,
  SOURCE_CODE_GITHUB_REPOSITORY,
} from "@/lib/public-github-repository";

describe("public GitHub repository configuration", () => {
  it("stays disabled when no public repository is configured", () => {
    expect(getConfiguredGitHubRepository({})).toBeNull();
  });

  it("accepts and trims a canonical repository name", () => {
    expect(
      getConfiguredGitHubRepository({
        SHADSCAN_PUBLIC_GITHUB_REPOSITORY: "  shadcn-ui/next-template  ",
      })
    ).toBe("shadcn-ui/next-template");
  });

  it.each([
    "https://github.com/shadcn-ui/next-template",
    "shadcn-ui/next-template/issues",
    "-owner/repository",
    "owner-/repository",
  ])("rejects a non-canonical value: %s", (repository) => {
    expect(() =>
      getConfiguredGitHubRepository({
        SHADSCAN_PUBLIC_GITHUB_REPOSITORY: repository,
      })
    ).toThrowError(
      "SHADSCAN_PUBLIC_GITHUB_REPOSITORY must be a canonical owner/repository name."
    );
  });
});

describe("public GitHub repository lookup", () => {
  it("returns a link only when GitHub confirms the repository is public", async () => {
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(Response.json({ private: false, stargazers_count: 42 }))
    );

    await expect(
      fetchPublicGitHubRepository(
        "shadcn-ui/next-template",
        fetchImplementation
      )
    ).resolves.toEqual({
      name: "shadcn-ui/next-template",
      stargazersCount: 42,
      url: "https://github.com/shadcn-ui/next-template",
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.github.com/repos/shadcn-ui/next-template",
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
        }),
        redirect: "error",
      })
    );
  });

  it.each([
    ["private", Response.json({ private: true, stargazers_count: 42 })],
    ["missing", new Response(null, { status: 404 })],
    ["malformed", Response.json({ private: false, stargazers_count: "42" })],
  ])("hides a %s repository response", async (_name, response) => {
    await expect(
      fetchPublicGitHubRepository("owner/repository", () =>
        Promise.resolve(response)
      )
    ).resolves.toBeNull();
  });

  it("hides the link when GitHub cannot be reached", async () => {
    await expect(
      fetchPublicGitHubRepository("owner/repository", () =>
        Promise.reject(new Error("offline"))
      )
    ).resolves.toBeNull();
  });
});

describe("GitHub stargazer count", () => {
  it("returns the stargazer count for a reachable repository", async () => {
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(Response.json({ stargazers_count: 128 }))
    );

    await expect(
      fetchGitHubStargazerCount("TheOrcDev/shadscan", fetchImplementation)
    ).resolves.toBe(128);
  });

  it("falls back to zero when GitHub cannot be reached", async () => {
    await expect(
      fetchGitHubStargazerCount("TheOrcDev/shadscan", () =>
        Promise.reject(new Error("offline"))
      )
    ).resolves.toBe(0);
  });

  it("exports the canonical source repository for header fallbacks", () => {
    expect(SOURCE_CODE_GITHUB_REPOSITORY).toBe("TheOrcDev/shadscan");
  });
});
