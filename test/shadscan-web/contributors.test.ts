import { describe, expect, it, vi } from "vitest";
import {
  type Contributor,
  fetchGitHubContributors,
  getContributorStats,
  resolveContributorsRepository,
} from "@/lib/contributors";
import type { FetchImplementation } from "@/lib/public-github-repository";
import { SOURCE_CODE_GITHUB_REPOSITORY } from "@/lib/public-github-repository";

const REPOSITORY = "TheOrcDev/shadscan";
const CONTRIBUTORS_URL = `https://api.github.com/repos/${REPOSITORY}/contributors?per_page=100`;

const createApiContributor = (overrides: Record<string, unknown> = {}) => ({
  avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
  contributions: 12,
  html_url: "https://github.com/orcdev",
  login: "orcdev",
  type: "User",
  ...overrides,
});

const respondWith =
  (payload: unknown): FetchImplementation =>
  () =>
    Promise.resolve(Response.json(payload));

describe("contributors repository resolution", () => {
  it("falls back to the source repository when none is configured", () => {
    expect(resolveContributorsRepository({})).toBe(
      SOURCE_CODE_GITHUB_REPOSITORY
    );
  });

  it("uses the configured public repository", () => {
    expect(
      resolveContributorsRepository({
        SHADSCAN_PUBLIC_GITHUB_REPOSITORY: "shadcn-ui/next-template",
      })
    ).toBe("shadcn-ui/next-template");
  });
});

describe("contributor fetching", () => {
  it("requests the contributor list without a token by default", async () => {
    const fetchImplementation = vi.fn(respondWith([createApiContributor()]));

    await expect(
      fetchGitHubContributors(REPOSITORY, fetchImplementation, {})
    ).resolves.toEqual([
      {
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4&s=96",
        contributions: 12,
        login: "orcdev",
        profileUrl: "https://github.com/orcdev",
      },
    ]);

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(CONTRIBUTORS_URL);
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("authorizes the request when a token is configured", async () => {
    const fetchImplementation = vi.fn(respondWith([]));

    await fetchGitHubContributors(REPOSITORY, fetchImplementation, {
      GITHUB_TOKEN: "token-value",
    });

    const [, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer token-value"
    );
  });

  it("requests avatars at the rendered size", async () => {
    const [contributor] = await fetchGitHubContributors(
      REPOSITORY,
      respondWith([
        createApiContributor({
          avatar_url: "https://avatars.githubusercontent.com/u/7?v=4&s=460",
        }),
      ]),
      {}
    );

    expect(contributor?.avatarUrl).toBe(
      "https://avatars.githubusercontent.com/u/7?v=4&s=96"
    );
  });

  it("ranks contributors by contributions, then login", async () => {
    const contributors = await fetchGitHubContributors(
      REPOSITORY,
      respondWith([
        createApiContributor({
          contributions: 3,
          html_url: "https://github.com/zara",
          login: "zara",
        }),
        createApiContributor({
          contributions: 9,
          html_url: "https://github.com/thrall",
          login: "thrall",
        }),
        createApiContributor({
          contributions: 3,
          html_url: "https://github.com/anduin",
          login: "anduin",
        }),
      ]),
      {}
    );

    expect(contributors.map(({ login }) => login)).toEqual([
      "thrall",
      "anduin",
      "zara",
    ]);
  });

  it.each([
    ["a bot account", createApiContributor({ type: "Bot" })],
    ["a zero-contribution entry", createApiContributor({ contributions: 0 })],
    [
      "a non-numeric contribution count",
      createApiContributor({ contributions: "12" }),
    ],
    [
      "an off-host avatar",
      createApiContributor({ avatar_url: "https://example.com/u/1.png" }),
    ],
    [
      "an unoptimizable avatar path",
      createApiContributor({
        avatar_url: "https://avatars.githubusercontent.com/in/1?v=4",
      }),
    ],
    [
      "an off-host profile link",
      createApiContributor({ html_url: "https://example.com/orcdev" }),
    ],
    [
      "a profile link for another account",
      createApiContributor({ html_url: "https://github.com/someone-else" }),
    ],
    ["a malformed entry", { login: "orcdev" }],
    ["a non-object entry", "orcdev"],
  ])("drops %s", async (_name, entry) => {
    await expect(
      fetchGitHubContributors(REPOSITORY, respondWith([entry]), {})
    ).resolves.toEqual([]);
  });

  it.each([
    ["an error response", new Response(null, { status: 404 })],
    ["a non-array payload", Response.json({ message: "Not Found" })],
  ])("returns an empty list for %s", async (_name, response) => {
    await expect(
      fetchGitHubContributors(REPOSITORY, () => Promise.resolve(response), {})
    ).resolves.toEqual([]);
  });

  it("returns an empty list when GitHub cannot be reached", async () => {
    await expect(
      fetchGitHubContributors(
        REPOSITORY,
        () => Promise.reject(new Error("network unreachable")),
        {}
      )
    ).resolves.toEqual([]);
  });
});

describe("contributor stats", () => {
  it("totals contributors and their contributions", () => {
    const contributors: Contributor[] = [
      {
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4&s=96",
        contributions: 40,
        login: "thrall",
        profileUrl: "https://github.com/thrall",
      },
      {
        avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
        contributions: 2,
        login: "zara",
        profileUrl: "https://github.com/zara",
      },
    ];

    expect(getContributorStats(contributors)).toEqual({
      totalContributions: 42,
      totalContributors: 2,
    });
  });

  it("reports zeroes for an empty list", () => {
    expect(getContributorStats([])).toEqual({
      totalContributions: 0,
      totalContributors: 0,
    });
  });
});
