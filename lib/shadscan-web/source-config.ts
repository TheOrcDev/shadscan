import type { ArchiveLimits } from "../shadscan-api/archive";
import { HostedScanError } from "../shadscan-api/errors";

const MEBIBYTE = 1024 * 1024;
const WEB_SOURCE_MODES = ["archive", "sparse", "auto"] as const;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

const DEFAULT_WEB_SOURCE_LIMITS: ArchiveLimits = {
  maxCompressedBytes: 32 * MEBIBYTE,
  maxEntries: 10_000,
  maxExpandedBytes: 128 * MEBIBYTE,
  maxFileBytes: 8 * MEBIBYTE,
  maxRawEntries: 10_000,
};

const WEB_SOURCE_HARD_LIMITS = {
  maxCompressedMib: 64,
  maxExpandedMib: 256,
  maxRawEntries: 50_000,
  maxRetainedFileMib: 16,
} as const;

type WebSourceMode = (typeof WEB_SOURCE_MODES)[number];

interface WebSourceConfig {
  limits: ArchiveLimits;
  mode: WebSourceMode;
}

type SourceEnvironment = Readonly<Record<string, string | undefined>>;

const throwInvalidSourceConfiguration = (variableName: string): never => {
  throw new HostedScanError(
    `The web source configuration is invalid for ${variableName}.`,
    {
      code: "SOURCE_CONFIGURATION_INVALID",
      status: 500,
    }
  );
};

const readPositiveInteger = (
  environment: SourceEnvironment,
  variableName: string,
  fallback: number,
  maximum: number
): number => {
  const rawValue = environment[variableName];
  if (rawValue === undefined || rawValue.length === 0) {
    return fallback;
  }
  if (!POSITIVE_INTEGER_PATTERN.test(rawValue)) {
    return throwInvalidSourceConfiguration(variableName);
  }

  const value = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(value) || value > maximum) {
    return throwInvalidSourceConfiguration(variableName);
  }
  return value;
};

const readSourceMode = (environment: SourceEnvironment): WebSourceMode => {
  const value = environment.SHADSCAN_WEB_SOURCE_MODE ?? "archive";
  if (!WEB_SOURCE_MODES.includes(value as WebSourceMode)) {
    return throwInvalidSourceConfiguration("SHADSCAN_WEB_SOURCE_MODE");
  }
  return value as WebSourceMode;
};

const getWebSourceConfig = (
  environment: SourceEnvironment = process.env
): WebSourceConfig => {
  const compressedMib = readPositiveInteger(
    environment,
    "SHADSCAN_WEB_MAX_COMPRESSED_MIB",
    DEFAULT_WEB_SOURCE_LIMITS.maxCompressedBytes / MEBIBYTE,
    WEB_SOURCE_HARD_LIMITS.maxCompressedMib
  );
  const expandedMib = readPositiveInteger(
    environment,
    "SHADSCAN_WEB_MAX_EXPANDED_MIB",
    DEFAULT_WEB_SOURCE_LIMITS.maxExpandedBytes / MEBIBYTE,
    WEB_SOURCE_HARD_LIMITS.maxExpandedMib
  );
  const maxRawEntries = readPositiveInteger(
    environment,
    "SHADSCAN_WEB_MAX_ARCHIVE_ENTRIES",
    DEFAULT_WEB_SOURCE_LIMITS.maxRawEntries,
    WEB_SOURCE_HARD_LIMITS.maxRawEntries
  );
  const retainedFileMib = readPositiveInteger(
    environment,
    "SHADSCAN_WEB_MAX_RETAINED_FILE_MIB",
    DEFAULT_WEB_SOURCE_LIMITS.maxFileBytes / MEBIBYTE,
    WEB_SOURCE_HARD_LIMITS.maxRetainedFileMib
  );

  return {
    limits: {
      ...DEFAULT_WEB_SOURCE_LIMITS,
      maxCompressedBytes: compressedMib * MEBIBYTE,
      maxExpandedBytes: expandedMib * MEBIBYTE,
      maxFileBytes: retainedFileMib * MEBIBYTE,
      maxRawEntries,
    },
    mode: readSourceMode(environment),
  };
};

export type { SourceEnvironment, WebSourceConfig, WebSourceMode };
export {
  DEFAULT_WEB_SOURCE_LIMITS,
  getWebSourceConfig,
  MEBIBYTE,
  WEB_SOURCE_HARD_LIMITS,
  WEB_SOURCE_MODES,
};
