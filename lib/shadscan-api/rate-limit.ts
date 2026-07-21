import {
  consumeDatabaseRateLimits,
  DatabaseRateLimitError,
  hashRateLimitIdentity,
} from "../rate-limit/database";
import {
  consumeMemoryRateLimits,
  type MemoryRateLimitStore,
} from "../rate-limit/memory";
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

const memoryStates: MemoryRateLimitStore = new Map();

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
  const [minuteDecision, dailyDecision] = consumeMemoryRateLimits(
    memoryStates,
    [
      {
        key: `api-key-minute:${keyId}`,
        limit: MINUTE_LIMIT,
        name: "minute",
        windowMs: MINUTE_MS,
      },
      {
        key: `api-key-daily:${keyId}`,
        limit: DAILY_LIMIT,
        name: "daily",
        windowMs: DAY_MS,
      },
    ],
    now
  );
  if (!(minuteDecision && dailyDecision)) {
    throw new Error("The in-memory API rate limiter is misconfigured.");
  }

  const failedDecision = [minuteDecision, dailyDecision]
    .filter((decision) => !decision.allowed)
    .sort((left, right) => right.resetAt - left.resetAt)[0];
  if (failedDecision) {
    throwRateLimitError(failedDecision, now);
  }

  return {
    limit: minuteDecision.limit,
    remaining: minuteDecision.remaining,
    resetAt: minuteDecision.resetAt,
  };
};

const checkDatabaseRateLimit = async (
  keyId: string,
  now = Date.now(),
  consume: typeof consumeDatabaseRateLimits = consumeDatabaseRateLimits
): Promise<RateLimitDecision> => {
  try {
    const identityHash = hashRateLimitIdentity("api-key", keyId);
    const [minute, daily] = await consume([
      {
        bucket: "api-key-minute",
        identityHash,
        maxRequests: MINUTE_LIMIT,
        name: "minute",
        windowMs: MINUTE_MS,
      },
      {
        bucket: "api-key-daily",
        identityHash,
        maxRequests: DAILY_LIMIT,
        name: "daily",
        windowMs: DAY_MS,
      },
    ]);

    const failedDecision = [minute, daily]
      .filter((decision) => !decision.allowed)
      .sort((left, right) => right.resetAt - left.resetAt)[0];
    if (failedDecision) {
      throwRateLimitError(failedDecision, now);
    }

    return {
      limit: minute.limit,
      remaining: minute.remaining,
      resetAt: minute.resetAt,
    };
  } catch (error) {
    if (error instanceof HostedScanError) {
      throw error;
    }

    if (
      error instanceof DatabaseRateLimitError &&
      error.code === "NOT_CONFIGURED"
    ) {
      throw new HostedScanError(
        "Distributed rate limiting is not configured.",
        {
          cause: error,
          code: "RATE_LIMIT_NOT_CONFIGURED",
          status: 503,
        }
      );
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
    process.env.NODE_ENV !== "production" && configuredMode !== "database";

  if (useMemory) {
    return Promise.resolve(checkMemoryRateLimit(keyId));
  }

  return checkDatabaseRateLimit(keyId);
};

const resetMemoryRateLimits = (): void => {
  memoryStates.clear();
};

export type { RateLimitDecision };
export {
  checkDatabaseRateLimit,
  checkMemoryRateLimit,
  enforceRateLimit,
  getRateLimitHeaders,
  resetMemoryRateLimits,
};
