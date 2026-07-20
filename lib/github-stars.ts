import { unstable_cache } from "next/cache";

const SOURCE_CODE_GITHUB_REPO = "TheOrcDev/headless-shadcn";
const REVALIDATE_SECONDS = 86_400;

const getGitHubStargazerCount = unstable_cache(
  async (): Promise<number> => {
    try {
      const headers = new Headers({
        Accept: "application/vnd.github+json",
        "User-Agent": "shadscan",
        "X-GitHub-Api-Version": "2022-11-28",
      });

      const token = process.env.GITHUB_TOKEN;
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const response = await fetch(
        `https://api.github.com/repos/${SOURCE_CODE_GITHUB_REPO}`,
        { headers }
      );

      if (!response.ok) {
        return 0;
      }

      const json = (await response.json()) as { stargazers_count?: number };
      return Number(json.stargazers_count) || 0;
    } catch {
      return 0;
    }
  },
  ["github-stargazer-count", SOURCE_CODE_GITHUB_REPO],
  { revalidate: REVALIDATE_SECONDS }
);

export { getGitHubStargazerCount, SOURCE_CODE_GITHUB_REPO };
