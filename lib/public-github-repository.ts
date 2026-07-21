import { unstable_cache } from "next/cache";

const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const REVALIDATE_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 3000;

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

export type { FetchImplementation, PublicGitHubRepository };
export {
  fetchPublicGitHubRepository,
  getConfiguredGitHubRepository,
  getPublicGitHubRepository,
};
