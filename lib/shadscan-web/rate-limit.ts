import { createHmac } from "node:crypto";
import {
  consumeDatabaseRateLimits,
  hashRateLimitIdentity,
} from "../rate-limit/database";
import { WebScanServiceError } from "./errors";

const DEVELOPMENT_RATE_LIMIT_SALT = "shadscan-web-development-rate-limit-salt";
const MINIMUM_PRODUCTION_SALT_LENGTH = 32;

const WEB_RATE_LIMITS = {
  clientDaily: {
    bucket: "web-client-daily",
    limit: 20,
    scope: "client",
    windowMs: 86_400_000,
  },
  clientShort: {
    bucket: "web-client-short",
    limit: 10,
    scope: "client",
    windowMs: 600_000,
  },
  repositoryDaily: {
    bucket: "web-repository-daily",
    limit: 10,
    scope: "repository",
    windowMs: 86_400_000,
  },
} as const;

type WebRateLimitName = keyof typeof WEB_RATE_LIMITS;
type RuntimeEnvironment = "development" | "production" | "test" | undefined;

interface WebRateLimitInput {
  clientAddress: string;
  repositoryKey: string;
}

interface WebRateLimitDecision {
  limit: number;
  name: WebRateLimitName;
  remaining: number;
  resetAt: number;
}

interface MemoryWindowState {
  count: number;
  startedAt: number;
}

interface EvaluatedMemoryRule {
  decision: WebRateLimitDecision;
  state: MemoryWindowState;
}

const memoryWindows = new Map<string, MemoryWindowState>();

const getClientRateLimitKey = (
  clientAddress: string,
  salt = process.env.SHADSCAN_WEB_RATE_LIMIT_SALT,
  environment: RuntimeEnvironment = process.env.NODE_ENV
): string => {
  if (
    environment === "production" &&
    (!salt || salt.length < MINIMUM_PRODUCTION_SALT_LENGTH)
  ) {
    throw new WebScanServiceError(
      "The web scanner is temporarily unavailable. Try again shortly.",
      { code: "SERVICE_NOT_CONFIGURED", retryable: true }
    );
  }

  const resolvedSalt = salt ?? DEVELOPMENT_RATE_LIMIT_SALT;
  const normalizedAddress = clientAddress.trim() || "unknown";
  return createHmac("sha256", resolvedSalt)
    .update(normalizedAddress, "utf8")
    .digest("hex");
};

const getMemoryWindow = (
  key: string,
  windowMs: number,
  now: number
): MemoryWindowState => {
  const existing = memoryWindows.get(key);
  if (!existing || now - existing.startedAt >= windowMs) {
    const next = { count: 0, startedAt: now };
    memoryWindows.set(key, next);
    return next;
  }
  return existing;
};

const throwWebRateLimitError = (
  decision: WebRateLimitDecision,
  now: number
): never => {
  const retryAfterSeconds = Math.max(
    1,
    Math.min(86_400, Math.ceil((decision.resetAt - now) / 1000))
  );
  throw new WebScanServiceError(
    `Too many scans have been requested. Try again in ${retryAfterSeconds} seconds.`,
    {
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterSeconds,
    }
  );
};

const getLimitIdentity = (
  name: WebRateLimitName,
  clientKey: string,
  repositoryKey: string
): string =>
  WEB_RATE_LIMITS[name].scope === "client" ? clientKey : repositoryKey;

const checkMemoryWebRateLimit = (
  input: WebRateLimitInput,
  now = Date.now(),
  salt?: string,
  environment?: RuntimeEnvironment
): WebRateLimitDecision[] => {
  const clientKey = getClientRateLimitKey(
    input.clientAddress,
    salt,
    environment
  );
  const evaluatedRules: EvaluatedMemoryRule[] = [];

  for (const name of Object.keys(WEB_RATE_LIMITS) as WebRateLimitName[]) {
    const rule = WEB_RATE_LIMITS[name];
    const identity = getLimitIdentity(name, clientKey, input.repositoryKey);
    const state = getMemoryWindow(`${name}:${identity}`, rule.windowMs, now);
    evaluatedRules.push({
      decision: {
        limit: rule.limit,
        name,
        remaining: Math.max(0, rule.limit - state.count - 1),
        resetAt: state.startedAt + rule.windowMs,
      },
      state,
    });
  }

  const failedDecision = evaluatedRules
    .filter(({ state, decision }) => state.count >= decision.limit)
    .map(({ decision }) => decision)
    .sort((left, right) => right.resetAt - left.resetAt)[0];
  if (failedDecision) {
    return throwWebRateLimitError(failedDecision, now);
  }

  for (const evaluatedRule of evaluatedRules) {
    evaluatedRule.state.count += 1;
  }

  return evaluatedRules.map(({ decision }) => decision);
};

const checkDatabaseWebRateLimit = async (
  input: WebRateLimitInput,
  now = Date.now(),
  consume: typeof consumeDatabaseRateLimits = consumeDatabaseRateLimits
): Promise<WebRateLimitDecision[]> => {
  try {
    const clientKey = getClientRateLimitKey(input.clientAddress);
    const repositoryKey = hashRateLimitIdentity(
      "web-repository",
      input.repositoryKey
    );
    const names = Object.keys(WEB_RATE_LIMITS) as WebRateLimitName[];
    const results = await consume(
      names.map((name) => {
        const rule = WEB_RATE_LIMITS[name];
        return {
          bucket: rule.bucket,
          identityHash: getLimitIdentity(name, clientKey, repositoryKey),
          maxRequests: rule.limit,
          name,
          windowMs: rule.windowMs,
        };
      })
    );
    const decisions = results.map((result, index) => ({
      limit: result.limit,
      name: names[index],
      remaining: result.remaining,
      resetAt: result.resetAt,
    }));
    const failedDecision = decisions
      .filter((_decision, index) => !results[index].allowed)
      .sort((left, right) => right.resetAt - left.resetAt)[0];
    if (failedDecision) {
      return throwWebRateLimitError(failedDecision, now);
    }

    return decisions;
  } catch (error) {
    if (error instanceof WebScanServiceError) {
      throw error;
    }

    throw new WebScanServiceError(
      "The web scanner is temporarily unavailable. Try again shortly.",
      {
        cause: error,
        code: "SERVICE_NOT_CONFIGURED",
        retryable: true,
      }
    );
  }
};

const enforceWebScanRateLimit = (
  input: WebRateLimitInput
): Promise<WebRateLimitDecision[]> => {
  const configuredMode = process.env.SHADSCAN_WEB_RATE_LIMIT_MODE;
  const useMemory =
    process.env.NODE_ENV !== "production" && configuredMode !== "database";
  return useMemory
    ? Promise.resolve(checkMemoryWebRateLimit(input))
    : checkDatabaseWebRateLimit(input);
};

const resetMemoryWebRateLimits = (): void => {
  memoryWindows.clear();
};

export type { WebRateLimitDecision, WebRateLimitInput, WebRateLimitName };
export {
  checkDatabaseWebRateLimit,
  checkMemoryWebRateLimit,
  enforceWebScanRateLimit,
  getClientRateLimitKey,
  MINIMUM_PRODUCTION_SALT_LENGTH,
  resetMemoryWebRateLimits,
  WEB_RATE_LIMITS,
};
