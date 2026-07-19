import { createHash, createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { WebScanServiceError } from "./errors";

const DEVELOPMENT_RATE_LIMIT_SALT = "shadscan-web-development-rate-limit-salt";
const MINIMUM_PRODUCTION_SALT_LENGTH = 32;

const WEB_RATE_LIMITS = {
  clientDaily: {
    duration: "1 d",
    limit: 20,
    scope: "client",
    windowMs: 86_400_000,
  },
  clientShort: {
    duration: "10 m",
    limit: 3,
    scope: "client",
    windowMs: 600_000,
  },
  repositoryDaily: {
    duration: "1 d",
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

type RedisRateLimiters = Record<WebRateLimitName, Ratelimit>;

const memoryWindows = new Map<string, MemoryWindowState>();
let cachedRedisLimiters: RedisRateLimiters | null = null;
let cachedRedisSignature: string | null = null;

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
  const decisions: WebRateLimitDecision[] = [];

  for (const name of Object.keys(WEB_RATE_LIMITS) as WebRateLimitName[]) {
    const rule = WEB_RATE_LIMITS[name];
    const identity = getLimitIdentity(name, clientKey, input.repositoryKey);
    const state = getMemoryWindow(`${name}:${identity}`, rule.windowMs, now);
    state.count += 1;
    decisions.push({
      limit: rule.limit,
      name,
      remaining: rule.limit - state.count,
      resetAt: state.startedAt + rule.windowMs,
    });
  }

  const failedDecision = decisions
    .filter((decision) => decision.remaining < 0)
    .sort((left, right) => right.resetAt - left.resetAt)[0];
  if (failedDecision) {
    return throwWebRateLimitError(failedDecision, now);
  }

  return decisions;
};

const getRedisRateLimiters = (): RedisRateLimiters => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!(url && token)) {
    throw new WebScanServiceError(
      "The web scanner is temporarily unavailable. Try again shortly.",
      { code: "SERVICE_NOT_CONFIGURED", retryable: true }
    );
  }

  const signature = createHash("sha256")
    .update(`${url}\0${token}`, "utf8")
    .digest("hex");
  if (cachedRedisLimiters && cachedRedisSignature === signature) {
    return cachedRedisLimiters;
  }

  const redis = new Redis({ token, url });
  cachedRedisLimiters = {
    clientDaily: new Ratelimit({
      analytics: false,
      limiter: Ratelimit.slidingWindow(
        WEB_RATE_LIMITS.clientDaily.limit,
        WEB_RATE_LIMITS.clientDaily.duration
      ),
      prefix: "shadscan:web:client:daily",
      redis,
    }),
    clientShort: new Ratelimit({
      analytics: false,
      limiter: Ratelimit.slidingWindow(
        WEB_RATE_LIMITS.clientShort.limit,
        WEB_RATE_LIMITS.clientShort.duration
      ),
      prefix: "shadscan:web:client:short",
      redis,
    }),
    repositoryDaily: new Ratelimit({
      analytics: false,
      limiter: Ratelimit.slidingWindow(
        WEB_RATE_LIMITS.repositoryDaily.limit,
        WEB_RATE_LIMITS.repositoryDaily.duration
      ),
      prefix: "shadscan:web:repository:daily",
      redis,
    }),
  };
  cachedRedisSignature = signature;
  return cachedRedisLimiters;
};

const checkRedisWebRateLimit = async (
  input: WebRateLimitInput,
  now = Date.now()
): Promise<WebRateLimitDecision[]> => {
  try {
    const clientKey = getClientRateLimitKey(input.clientAddress);
    const limiters = getRedisRateLimiters();
    const names = Object.keys(WEB_RATE_LIMITS) as WebRateLimitName[];
    const results = await Promise.all(
      names.map((name) =>
        limiters[name].limit(
          getLimitIdentity(name, clientKey, input.repositoryKey)
        )
      )
    );
    const decisions = results.map((result, index) => ({
      limit: result.limit,
      name: names[index],
      remaining: result.remaining,
      resetAt: result.reset,
    }));
    const failedDecision = decisions
      .filter((_decision, index) => !results[index].success)
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
    process.env.NODE_ENV !== "production" && configuredMode !== "redis";
  return useMemory
    ? Promise.resolve(checkMemoryWebRateLimit(input))
    : checkRedisWebRateLimit(input);
};

const resetMemoryWebRateLimits = (): void => {
  memoryWindows.clear();
};

export type { WebRateLimitDecision, WebRateLimitInput, WebRateLimitName };
export {
  checkMemoryWebRateLimit,
  enforceWebScanRateLimit,
  getClientRateLimitKey,
  MINIMUM_PRODUCTION_SALT_LENGTH,
  resetMemoryWebRateLimits,
  WEB_RATE_LIMITS,
};
