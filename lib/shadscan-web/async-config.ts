import { SCAN_SOURCE_LIMITS } from "@shadscan/cli";
import { HostedScanError } from "../shadscan-api/errors";

const MEBIBYTE = 1024 * 1024;
const DEFAULT_ASYNC_JOB_TTL_HOURS = 24;
const DEFAULT_ASYNC_MAX_ATTEMPTS = 5;
const DEFAULT_ASYNC_MAX_CONCURRENCY = 2;
const DEFAULT_SYNC_RELEVANT_FILES = 1500;
const DEFAULT_SYNC_RELEVANT_MIB = 16;
const MAX_ASYNC_JOB_TTL_HOURS = 24 * 7;
const MAX_ASYNC_MAX_ATTEMPTS = 10;
const MAX_ASYNC_MAX_CONCURRENCY = 10;
const BOOLEAN_VALUES = new Set(["false", "true"]);
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

interface WebAsyncConfig {
  enabled: boolean;
  jobTtlSeconds: number;
  maxAttempts: number;
  maxConcurrency: number;
  syncRelevantBytes: number;
  syncRelevantFiles: number;
}

type AsyncEnvironment = Readonly<Record<string, string | undefined>>;

const throwInvalidAsyncConfiguration = (variableName: string): never => {
  throw new HostedScanError(
    `The asynchronous scanner configuration is invalid for ${variableName}.`,
    {
      code: "ASYNC_CONFIGURATION_INVALID",
      status: 500,
    }
  );
};

const readPositiveInteger = (
  environment: AsyncEnvironment,
  variableName: string,
  fallback: number,
  maximum: number
): number => {
  const rawValue = environment[variableName];
  if (rawValue === undefined || rawValue.length === 0) {
    return fallback;
  }
  if (!POSITIVE_INTEGER_PATTERN.test(rawValue)) {
    return throwInvalidAsyncConfiguration(variableName);
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(value) || value > maximum) {
    return throwInvalidAsyncConfiguration(variableName);
  }
  return value;
};

const getWebAsyncConfig = (
  environment: AsyncEnvironment = process.env
): WebAsyncConfig => {
  const enabledValue = environment.SHADSCAN_WEB_ASYNC_ENABLED ?? "false";
  if (!BOOLEAN_VALUES.has(enabledValue)) {
    return throwInvalidAsyncConfiguration("SHADSCAN_WEB_ASYNC_ENABLED");
  }
  if (enabledValue === "false") {
    return {
      enabled: false,
      jobTtlSeconds: DEFAULT_ASYNC_JOB_TTL_HOURS * 60 * 60,
      maxAttempts: DEFAULT_ASYNC_MAX_ATTEMPTS,
      maxConcurrency: DEFAULT_ASYNC_MAX_CONCURRENCY,
      syncRelevantBytes: DEFAULT_SYNC_RELEVANT_MIB * MEBIBYTE,
      syncRelevantFiles: DEFAULT_SYNC_RELEVANT_FILES,
    };
  }

  const syncRelevantMib = readPositiveInteger(
    environment,
    "SHADSCAN_WEB_SYNC_RELEVANT_MIB",
    DEFAULT_SYNC_RELEVANT_MIB,
    SCAN_SOURCE_LIMITS.maxTotalBytes / MEBIBYTE
  );

  return {
    enabled: true,
    jobTtlSeconds:
      readPositiveInteger(
        environment,
        "SHADSCAN_WEB_ASYNC_JOB_TTL_HOURS",
        DEFAULT_ASYNC_JOB_TTL_HOURS,
        MAX_ASYNC_JOB_TTL_HOURS
      ) *
      60 *
      60,
    maxAttempts: readPositiveInteger(
      environment,
      "SHADSCAN_WEB_ASYNC_MAX_ATTEMPTS",
      DEFAULT_ASYNC_MAX_ATTEMPTS,
      MAX_ASYNC_MAX_ATTEMPTS
    ),
    maxConcurrency: readPositiveInteger(
      environment,
      "SHADSCAN_WEB_ASYNC_MAX_CONCURRENCY",
      DEFAULT_ASYNC_MAX_CONCURRENCY,
      MAX_ASYNC_MAX_CONCURRENCY
    ),
    syncRelevantBytes: syncRelevantMib * MEBIBYTE,
    syncRelevantFiles: readPositiveInteger(
      environment,
      "SHADSCAN_WEB_SYNC_RELEVANT_FILES",
      DEFAULT_SYNC_RELEVANT_FILES,
      SCAN_SOURCE_LIMITS.maxFiles
    ),
  };
};

export type { AsyncEnvironment, WebAsyncConfig };
export {
  DEFAULT_ASYNC_JOB_TTL_HOURS,
  DEFAULT_ASYNC_MAX_ATTEMPTS,
  DEFAULT_ASYNC_MAX_CONCURRENCY,
  DEFAULT_SYNC_RELEVANT_FILES,
  DEFAULT_SYNC_RELEVANT_MIB,
  getWebAsyncConfig,
  MAX_ASYNC_JOB_TTL_HOURS,
  MAX_ASYNC_MAX_ATTEMPTS,
  MAX_ASYNC_MAX_CONCURRENCY,
};
