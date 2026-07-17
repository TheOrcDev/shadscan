import { createHash } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { HostedScanError } from "./errors";

const MINUTE_LIMIT = 10;
const DAILY_LIMIT = 100;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

interface RateLimitDecision {
  limit: number;
  remaining: number;
  resetAt: number;
}

interface FixedWindowState {
  count: number;
  startedAt: number;
}

interface MemoryKeyState {
  daily: FixedWindowState;
  minute: FixedWindowState;
}

interface RedisRateLimiters {
  daily: Ratelimit;
  minute: Ratelimit;
}

const memoryStates = new Map<string, MemoryKeyState>();
let cachedRedisLimiters: RedisRateLimiters | null = null;
let cachedRedisSignature: string | null = null;

const createWindowState = (now: number): FixedWindowState => ({
  count: 0,
  startedAt: now,
});

const advanceWindow = (
  state: FixedWindowState,
  windowMs: number,
  now: number
): FixedWindowState =>
  now - state.startedAt >= windowMs ? createWindowState(now) : state;

const getMemoryState = (keyId: string, now: number): MemoryKeyState => {
  const existing = memoryStates.get(keyId) ?? {
    daily: createWindowState(now),
    minute: createWindowState(now),
  };
  const nextState = {
    daily: advanceWindow(existing.daily, DAY_MS, now),
    minute: advanceWindow(existing.minute, MINUTE_MS, now),
  };
  memoryStates.set(keyId, nextState);
  return nextState;
};

const getRateLimitHeaders = (
  decision: RateLimitDecision,
  now: number
): Record<string, string> => ({
  "RateLimit-Limit": decision.limit.toString(),
  "RateLimit-Remaining": Math.max(0, decision.remaining).toString(),
  "RateLimit-Reset": Math.max(
    0,
    Math.ceil((decision.resetAt - now) / 1000)
  ).toString(),
});

const throwRateLimitError = (
  decision: RateLimitDecision,
  now: number
): never => {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((decision.resetAt - now) / 1000)
  );
  throw new HostedScanError("The API key has exceeded its scan limit.", {
    code: "RATE_LIMITED",
    headers: {
      ...getRateLimitHeaders(decision, now),
      "Retry-After": retryAfterSeconds.toString(),
    },
    retryable: true,
    status: 429,
  });
};

const checkMemoryRateLimit = (
  keyId: string,
  now = Date.now()
): RateLimitDecision => {
  const state = getMemoryState(keyId, now);
  state.minute.count += 1;
  state.daily.count += 1;

  const minuteDecision = {
    limit: MINUTE_LIMIT,
    remaining: MINUTE_LIMIT - state.minute.count,
    resetAt: state.minute.startedAt + MINUTE_MS,
  };
  const dailyDecision = {
    limit: DAILY_LIMIT,
    remaining: DAILY_LIMIT - state.daily.count,
    resetAt: state.daily.startedAt + DAY_MS,
  };

  if (minuteDecision.remaining < 0) {
    throwRateLimitError(minuteDecision, now);
  }

  if (dailyDecision.remaining < 0) {
    throwRateLimitError(dailyDecision, now);
  }

  return minuteDecision;
};

const getRedisRateLimiters = (): RedisRateLimiters => {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!(url && token)) {
    throw new HostedScanError("Distributed rate limiting is not configured.", {
      code: "RATE_LIMIT_NOT_CONFIGURED",
      status: 503,
    });
  }

  const signature = createHash("sha256")
    .update(`${url}\0${token}`, "utf8")
    .digest("hex");
  if (cachedRedisLimiters && cachedRedisSignature === signature) {
    return cachedRedisLimiters;
  }

  const redis = new Redis({ token, url });
  cachedRedisLimiters = {
    daily: new Ratelimit({
      analytics: false,
      limiter: Ratelimit.slidingWindow(DAILY_LIMIT, "1 d"),
      prefix: "shadscan:daily",
      redis,
    }),
    minute: new Ratelimit({
      analytics: false,
      limiter: Ratelimit.slidingWindow(MINUTE_LIMIT, "1 m"),
      prefix: "shadscan:minute",
      redis,
    }),
  };
  cachedRedisSignature = signature;
  return cachedRedisLimiters;
};

const checkRedisRateLimit = async (
  keyId: string,
  now = Date.now()
): Promise<RateLimitDecision> => {
  try {
    const limiters = getRedisRateLimiters();
    const [minute, daily] = await Promise.all([
      limiters.minute.limit(keyId),
      limiters.daily.limit(keyId),
    ]);

    if (!minute.success) {
      throwRateLimitError(
        {
          limit: minute.limit,
          remaining: minute.remaining,
          resetAt: minute.reset,
        },
        now
      );
    }

    if (!daily.success) {
      throwRateLimitError(
        {
          limit: daily.limit,
          remaining: daily.remaining,
          resetAt: daily.reset,
        },
        now
      );
    }

    return {
      limit: minute.limit,
      remaining: minute.remaining,
      resetAt: minute.reset,
    };
  } catch (error) {
    if (error instanceof HostedScanError) {
      throw error;
    }

    throw new HostedScanError("The rate limiter is temporarily unavailable.", {
      cause: error,
      code: "RATE_LIMIT_UNAVAILABLE",
      retryable: true,
      status: 503,
    });
  }
};

const enforceRateLimit = (keyId: string): Promise<RateLimitDecision> => {
  const configuredMode = process.env.SHADSCAN_RATE_LIMIT_MODE;
  const useMemory =
    process.env.NODE_ENV !== "production" && configuredMode !== "redis";

  if (useMemory) {
    return Promise.resolve(checkMemoryRateLimit(keyId));
  }

  return checkRedisRateLimit(keyId);
};

const resetMemoryRateLimits = (): void => {
  memoryStates.clear();
};

export type { RateLimitDecision };
export {
  checkMemoryRateLimit,
  enforceRateLimit,
  getRateLimitHeaders,
  resetMemoryRateLimits,
};
