import { unstable_cache } from "next/cache";
import type { FetchImplementation } from "@/lib/public-github-repository";
import {
  getConfiguredGitHubRepository,
  SOURCE_CODE_GITHUB_REPOSITORY,
} from "@/lib/public-github-repository";

const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_AVATAR_HOST = "avatars.githubusercontent.com";
const GITHUB_AVATAR_PATH_PREFIX = "/u/";
// Twice the rendered avatar size, so retina screens stay sharp without pulling
// full-resolution avatars for every contributor.
const AVATAR_REQUEST_SIZE_PX = 96;
const GITHUB_PROFILE_HOST = "github.com";
const CONTRIBUTORS_PER_PAGE = 100;
const REVALIDATE_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 3000;
// GitHub reports automation accounts alongside people; this page is about people.
const BOT_ACCOUNT_TYPE = "Bot";

interface Contributor {
  avatarUrl: string;
  contributions: number;
  login: string;
  profileUrl: string;
}

interface ContributorStats {
  totalContributions: number;
  totalContributors: number;
}

interface ContributorsEnvironment {
  GITHUB_TOKEN?: string;
  SHADSCAN_PUBLIC_GITHUB_REPOSITORY?: string;
  readonly [key: string]: string | undefined;
}

const isHttpsUrl = (
  value: string,
  host: string,
  pathPrefix: string
): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.host === host &&
      url.pathname.startsWith(pathPrefix)
    );
  } catch {
    return false;
  }
};

const toAvatarUrl = (value: string): string => {
  const avatarUrl = new URL(value);
  avatarUrl.searchParams.set("s", String(AVATAR_REQUEST_SIZE_PX));
  return avatarUrl.href;
};

/**
 * Keeps unexpected GitHub payloads from reaching the page as broken cards, and
 * keeps avatars and profile links pointed at GitHub.
 */
const toContributor = (entry: unknown): Contributor | null => {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }

  const {
    avatar_url: avatarUrl,
    contributions,
    html_url: profileUrl,
    login,
    type,
  } = entry as Record<string, unknown>;

  if (
    typeof login !== "string" ||
    typeof avatarUrl !== "string" ||
    typeof profileUrl !== "string" ||
    typeof contributions !== "number"
  ) {
    return null;
  }

  if (
    login.length === 0 ||
    !Number.isSafeInteger(contributions) ||
    contributions <= 0 ||
    type === BOT_ACCOUNT_TYPE ||
    !isHttpsUrl(avatarUrl, GITHUB_AVATAR_HOST, GITHUB_AVATAR_PATH_PREFIX) ||
    !isHttpsUrl(profileUrl, GITHUB_PROFILE_HOST, `/${login}`)
  ) {
    return null;
  }

  return {
    avatarUrl: toAvatarUrl(avatarUrl),
    contributions,
    login,
    profileUrl,
  };
};

const byContributionsThenLogin = (
  first: Contributor,
  second: Contributor
): number =>
  second.contributions - first.contributions ||
  first.login.localeCompare(second.login);

const fetchGitHubContributors = async (
  repository: string,
  fetchImplementation: FetchImplementation = fetch,
  environment: ContributorsEnvironment = process.env
): Promise<Contributor[]> => {
  try {
    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "User-Agent": "shadscan",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    const token = environment.GITHUB_TOKEN;
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetchImplementation(
      `${GITHUB_API_ORIGIN}/repos/${repository}/contributors?per_page=${CONTRIBUTORS_PER_PAGE}`,
      {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      return [];
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      return [];
    }

    const contributors: Contributor[] = [];
    for (const entry of payload) {
      const contributor = toContributor(entry);
      if (contributor !== null) {
        contributors.push(contributor);
      }
    }

    return contributors.sort(byContributionsThenLogin);
  } catch {
    return [];
  }
};

const getCachedGitHubContributors = unstable_cache(
  fetchGitHubContributors,
  ["github-contributors"],
  { revalidate: REVALIDATE_SECONDS }
);

const resolveContributorsRepository = (
  environment: ContributorsEnvironment = process.env
): string =>
  getConfiguredGitHubRepository(environment) ?? SOURCE_CODE_GITHUB_REPOSITORY;

/**
 * Contributors for the source repository. Resolves to an empty list whenever
 * GitHub is unreachable or the repository is still private, so the page always
 * renders.
 */
const getContributors = (
  environment: ContributorsEnvironment = process.env
): Promise<Contributor[]> =>
  getCachedGitHubContributors(resolveContributorsRepository(environment));

const getContributorStats = (
  contributors: readonly Contributor[]
): ContributorStats => ({
  totalContributions: contributors.reduce(
    (total, contributor) => total + contributor.contributions,
    0
  ),
  totalContributors: contributors.length,
});

export type { Contributor, ContributorStats };
export {
  fetchGitHubContributors,
  getContributorStats,
  getContributors,
  resolveContributorsRepository,
};
