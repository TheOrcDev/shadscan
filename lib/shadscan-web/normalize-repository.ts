import { GitHubSourceSchema } from "../shadscan-api/contracts";
import {
  NormalizedGitHubRepositorySchema,
  RepositoryInputSchema,
} from "./contracts";
import { WebScanServiceError } from "./errors";
import type { NormalizedGitHubRepository } from "./types";

const GITHUB_HOSTNAME = "github.com";
const GIT_SUFFIX = ".git";
const INVALID_REPOSITORY_MESSAGE =
  "Enter a GitHub repository as owner/repository or a canonical https://github.com/owner/repository URL.";

const throwInvalidRepository = (cause?: unknown): never => {
  throw new WebScanServiceError(INVALID_REPOSITORY_MESSAGE, {
    cause,
    code: "INVALID_REPOSITORY",
  });
};

const removeGitSuffix = (repositoryName: string): string =>
  repositoryName.toLowerCase().endsWith(GIT_SUFFIX)
    ? repositoryName.slice(0, -GIT_SUFFIX.length)
    : repositoryName;

const getRepositoryFromUrl = (repositoryInput: string): string => {
  let repositoryUrl: URL;
  try {
    repositoryUrl = new URL(repositoryInput);
  } catch (error) {
    return throwInvalidRepository(error);
  }

  if (
    repositoryUrl.protocol !== "https:" ||
    repositoryUrl.hostname.toLowerCase() !== GITHUB_HOSTNAME ||
    repositoryUrl.username.length > 0 ||
    repositoryUrl.password.length > 0 ||
    repositoryUrl.port.length > 0 ||
    repositoryUrl.search.length > 0 ||
    repositoryUrl.hash.length > 0 ||
    repositoryUrl.pathname.includes("%")
  ) {
    return throwInvalidRepository();
  }

  const pathname = repositoryUrl.pathname.endsWith("/")
    ? repositoryUrl.pathname.slice(0, -1)
    : repositoryUrl.pathname;
  const [empty, owner, rawRepository, ...extraSegments] = pathname.split("/");
  if (empty !== "" || !owner || !rawRepository || extraSegments.length > 0) {
    return throwInvalidRepository();
  }

  return `${owner}/${removeGitSuffix(rawRepository)}`;
};

const getRepositoryFromSlug = (repositoryInput: string): string => {
  if (
    repositoryInput.includes("://") ||
    repositoryInput.includes("?") ||
    repositoryInput.includes("#") ||
    repositoryInput.includes("%")
  ) {
    return throwInvalidRepository();
  }

  const [owner, rawRepository, ...extraSegments] = repositoryInput.split("/");
  if (!(owner && rawRepository) || extraSegments.length > 0) {
    return throwInvalidRepository();
  }

  return `${owner}/${removeGitSuffix(rawRepository)}`;
};

const normalizeGitHubRepository = (
  input: unknown
): NormalizedGitHubRepository => {
  const repositoryInputResult = RepositoryInputSchema.safeParse(input);
  if (!repositoryInputResult.success) {
    return throwInvalidRepository(repositoryInputResult.error);
  }

  const repositoryInput = repositoryInputResult.data;
  const repository = repositoryInput.startsWith("https://")
    ? getRepositoryFromUrl(repositoryInput)
    : getRepositoryFromSlug(repositoryInput);
  const sourceResult = GitHubSourceSchema.safeParse({
    kind: "github",
    repository,
  });
  if (!sourceResult.success) {
    return throwInvalidRepository(sourceResult.error);
  }

  return NormalizedGitHubRepositorySchema.parse({
    repository: sourceResult.data.repository,
    repositoryInput,
    repositoryKey: sourceResult.data.repository.toLowerCase(),
    repositoryUrl: `https://${GITHUB_HOSTNAME}/${sourceResult.data.repository}`,
  });
};

export { INVALID_REPOSITORY_MESSAGE, normalizeGitHubRepository };
