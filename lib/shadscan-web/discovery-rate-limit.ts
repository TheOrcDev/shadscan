import { consumeDatabaseRateLimits } from "../rate-limit/database";
import {
  consumeMemoryRateLimits,
  type MemoryRateLimitStore,
} from "../rate-limit/memory";
import { WebScanServiceError } from "./errors";
import { getClientRateLimitKey, type WebRateLimitInput } from "./rate-limit";

const WEB_DISCOVERY_RATE_LIMIT = {
  bucket: "web-discovery-short",
  limit: 30,
  name: "discoveryShort",
  windowMs: 600_000,
} as const;

const discoveryMemoryWindows: MemoryRateLimitStore = new Map();

const throwDiscoveryRateLimit = (resetAt: number, now: number): never => {
  const retryAfterSeconds = Math.max(
    1,
    Math.min(86_400, Math.ceil((resetAt - now) / 1000))
  );
  throw new WebScanServiceError(
    `Too many repository discoveries have been requested. Try again in ${retryAfterSeconds} seconds.`,
    {
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterSeconds,
    }
  );
};

const checkMemoryWebDiscoveryRateLimit = (
  input: WebRateLimitInput,
  now = Date.now()
): void => {
  const clientKey = getClientRateLimitKey(input.clientAddress);
  const [decision] = consumeMemoryRateLimits(
    discoveryMemoryWindows,
    [
      {
        key: `${WEB_DISCOVERY_RATE_LIMIT.bucket}:${clientKey}`,
        limit: WEB_DISCOVERY_RATE_LIMIT.limit,
        name: WEB_DISCOVERY_RATE_LIMIT.name,
        windowMs: WEB_DISCOVERY_RATE_LIMIT.windowMs,
      },
    ],
    now
  );
  if (decision && !decision.allowed) {
    throwDiscoveryRateLimit(decision.resetAt, now);
  }
};

const checkDatabaseWebDiscoveryRateLimit = async (
  input: WebRateLimitInput,
  now = Date.now()
): Promise<void> => {
  try {
    const clientKey = getClientRateLimitKey(input.clientAddress);
    const [decision] = await consumeDatabaseRateLimits([
      {
        bucket: WEB_DISCOVERY_RATE_LIMIT.bucket,
        identityHash: clientKey,
        maxRequests: WEB_DISCOVERY_RATE_LIMIT.limit,
        name: WEB_DISCOVERY_RATE_LIMIT.name,
        windowMs: WEB_DISCOVERY_RATE_LIMIT.windowMs,
      },
    ]);
    if (decision && !decision.allowed) {
      throwDiscoveryRateLimit(decision.resetAt, now);
    }
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

const enforceWebDiscoveryRateLimit = (
  input: WebRateLimitInput
): Promise<void> => {
  const configuredMode = process.env.SHADSCAN_WEB_RATE_LIMIT_MODE;
  const useMemory =
    process.env.NODE_ENV !== "production" && configuredMode !== "database";
  if (useMemory) {
    checkMemoryWebDiscoveryRateLimit(input);
    return Promise.resolve();
  }
  return checkDatabaseWebDiscoveryRateLimit(input);
};

const resetMemoryWebDiscoveryRateLimits = (): void => {
  discoveryMemoryWindows.clear();
};

export {
  checkDatabaseWebDiscoveryRateLimit,
  checkMemoryWebDiscoveryRateLimit,
  enforceWebDiscoveryRateLimit,
  resetMemoryWebDiscoveryRateLimits,
  WEB_DISCOVERY_RATE_LIMIT,
};
