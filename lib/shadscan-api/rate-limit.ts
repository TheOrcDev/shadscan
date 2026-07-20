import {
  consumeDatabaseRateLimits,
  DatabaseRateLimitError,
  hashRateLimitIdentity,
} from "../rate-limit/database";
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

const memoryStates = new Map<string, MemoryKeyState>();

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

    if (!minute.allowed) {
      throwRateLimitError(
        {
          limit: minute.limit,
          remaining: minute.remaining,
          resetAt: minute.resetAt,
        },
        now
      );
    }

    if (!daily.allowed) {
      throwRateLimitError(
        {
          limit: daily.limit,
          remaining: daily.remaining,
          resetAt: daily.resetAt,
        },
        now
      );
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
