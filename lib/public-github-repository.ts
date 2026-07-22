import { unstable_cache } from "next/cache";

const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const REVALIDATE_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 3000;
// Canonical source repo for header stars and marketing CTAs while
// SHADSCAN_PUBLIC_GITHUB_REPOSITORY is unset (private until public release).
const SOURCE_CODE_GITHUB_REPOSITORY = "TheOrcDev/shadscan";

interface PublicGitHubRepository {
  name: string;
  stargazersCount: number;
  url: string;
}

interface PublicRepositoryEnvironment {
  SHADSCAN_PUBLIC_GITHUB_REPOSITORY?: string;
  readonly [key: string]: string | undefined;
}

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

const isGitHubRepositoryName = (value: string): boolean => {
  const [owner, repository, ...rest] = value.split("/");

  return (
    rest.length === 0 &&
    owner !== undefined &&
    repository !== undefined &&
    GITHUB_OWNER_PATTERN.test(owner) &&
    GITHUB_REPOSITORY_PATTERN.test(repository)
  );
};

const getConfiguredGitHubRepository = (
  environment: PublicRepositoryEnvironment = process.env
): string | null => {
  const repository =
    environment.SHADSCAN_PUBLIC_GITHUB_REPOSITORY?.trim() ?? "";

  if (repository.length === 0) {
    return null;
  }

  if (!isGitHubRepositoryName(repository)) {
    throw new Error(
      "SHADSCAN_PUBLIC_GITHUB_REPOSITORY must be a canonical owner/repository name."
    );
  }

  return repository;
};

const fetchPublicGitHubRepository = async (
  repository: string,
  fetchImplementation: FetchImplementation = fetch
): Promise<PublicGitHubRepository | null> => {
  try {
    const response = await fetchImplementation(
      `${GITHUB_API_ORIGIN}/repos/${repository}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "shadscan",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      return null;
    }

    const metadata: unknown = await response.json();
    if (typeof metadata !== "object" || metadata === null) {
      return null;
    }

    const { private: isPrivate, stargazers_count: stargazersCount } =
      metadata as Record<string, unknown>;
    if (
      isPrivate !== false ||
      typeof stargazersCount !== "number" ||
      !Number.isSafeInteger(stargazersCount) ||
      stargazersCount < 0
    ) {
      return null;
    }

    return {
      name: repository,
      stargazersCount,
      url: `https://github.com/${repository}`,
    };
  } catch {
    return null;
  }
};

const getCachedPublicGitHubRepository = unstable_cache(
  fetchPublicGitHubRepository,
  ["public-github-repository"],
  { revalidate: REVALIDATE_SECONDS }
);

const getPublicGitHubRepository = (
  environment: PublicRepositoryEnvironment = process.env
): Promise<PublicGitHubRepository | null> => {
  const repository = getConfiguredGitHubRepository(environment);

  if (repository === null) {
    return Promise.resolve(null);
  }

  return getCachedPublicGitHubRepository(repository);
};

const fetchGitHubStargazerCount = async (
  repository: string,
  fetchImplementation: FetchImplementation = fetch
): Promise<number> => {
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

    const response = await fetchImplementation(
      `${GITHUB_API_ORIGIN}/repos/${repository}`,
      {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      return 0;
    }

    const metadata: unknown = await response.json();
    if (typeof metadata !== "object" || metadata === null) {
      return 0;
    }

    const { stargazers_count: stargazersCount } = metadata as Record<
      string,
      unknown
    >;
    if (
      typeof stargazersCount !== "number" ||
      !Number.isSafeInteger(stargazersCount) ||
      stargazersCount < 0
    ) {
      return 0;
    }

    return stargazersCount;
  } catch {
    return 0;
  }
};

const getCachedGitHubStargazerCount = unstable_cache(
  fetchGitHubStargazerCount,
  ["github-stargazer-count"],
  { revalidate: REVALIDATE_SECONDS }
);

/** Always-available repo + star count for the site header. */
const getHeaderGitHubRepository = async (
  environment: PublicRepositoryEnvironment = process.env
): Promise<Pick<PublicGitHubRepository, "name" | "stargazersCount">> => {
  const publicRepository = await getPublicGitHubRepository(environment);
  if (publicRepository !== null) {
    return {
      name: publicRepository.name,
      stargazersCount: publicRepository.stargazersCount,
    };
  }

  const name =
    getConfiguredGitHubRepository(environment) ?? SOURCE_CODE_GITHUB_REPOSITORY;

  return {
    name,
    stargazersCount: await getCachedGitHubStargazerCount(name),
  };
};

export type { FetchImplementation, PublicGitHubRepository };
export {
  fetchGitHubStargazerCount,
  fetchPublicGitHubRepository,
  getConfiguredGitHubRepository,
  getHeaderGitHubRepository,
  getPublicGitHubRepository,
  SOURCE_CODE_GITHUB_REPOSITORY,
};
