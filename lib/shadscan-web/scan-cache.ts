import { createHash, randomUUID } from "node:crypto";
import {
  AGENT_PROMPT_VERSION,
  AUDIT_REPORT_SCHEMA_VERSION,
  BUNDLED_RULESET_VERSION,
  ENGINE_VERSION,
} from "@shadscan/cli";
import { z } from "zod";
import {
  type HostedScanResponse,
  HostedScanResponseSchema,
} from "../shadscan-api/contracts";
import { HostedScanError } from "../shadscan-api/errors";
import { HOSTED_SCAN_SCHEMA_VERSION } from "../shadscan-api/protocol";
import { getDatabase } from "../db/client";

const CACHE_IDENTITY_SCHEMA_VERSION = 1;
const DEFAULT_CACHE_TTL_HOURS = 24 * 7;
const MAX_CACHE_TTL_HOURS = 24 * 30;
const BOOLEAN_VALUES = new Set(["false", "true"]);
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

interface ScanCacheConfig {
  enabled: boolean;
  ttlSeconds: number;
}

interface ScanCacheIdentity {
  category?: string;
  commitSha: string;
  projectPath: string;
  repositoryKey: string;
}

interface ScanCacheDescriptor {
  cacheKey: string;
  category: string;
  commitSha: string;
  engineVersion: string;
  projectPath: string;
  repositoryHash: string;
  rulesetVersion: string;
}

type ScanCacheEnvironment = Readonly<Record<string, string | undefined>>;
type ExecuteCacheRead = (cacheKey: string) => Promise<unknown>;
type ExecuteCacheWrite = (
  descriptor: ScanCacheDescriptor,
  response: HostedScanResponse,
  ttlSeconds: number
) => Promise<unknown>;

const CacheRowsSchema = z
  .array(
    z.object({
      payload: z.unknown(),
    })
  )
  .max(1);

const throwInvalidCacheConfiguration = (variableName: string): never => {
  throw new HostedScanError(
    `The web cache configuration is invalid for ${variableName}.`,
    {
      code: "SOURCE_CONFIGURATION_INVALID",
      status: 500,
    }
  );
};

const getScanCacheConfig = (
  environment: ScanCacheEnvironment = process.env
): ScanCacheConfig => {
  const enabledValue = environment.SHADSCAN_WEB_CACHE_ENABLED ?? "false";
  if (!BOOLEAN_VALUES.has(enabledValue)) {
    return throwInvalidCacheConfiguration("SHADSCAN_WEB_CACHE_ENABLED");
  }

  const ttlValue =
    environment.SHADSCAN_WEB_CACHE_TTL_HOURS ??
    DEFAULT_CACHE_TTL_HOURS.toString();
  if (!POSITIVE_INTEGER_PATTERN.test(ttlValue)) {
    return throwInvalidCacheConfiguration("SHADSCAN_WEB_CACHE_TTL_HOURS");
  }
  const ttlHours = Number.parseInt(ttlValue, 10);
  if (!Number.isSafeInteger(ttlHours) || ttlHours > MAX_CACHE_TTL_HOURS) {
    return throwInvalidCacheConfiguration("SHADSCAN_WEB_CACHE_TTL_HOURS");
  }

  return {
    enabled: enabledValue === "true",
    ttlSeconds: ttlHours * 60 * 60,
  };
};

const hashValue = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const createScanCacheDescriptor = (
  identity: ScanCacheIdentity
): ScanCacheDescriptor => {
  const category = identity.category ?? "all";
  const repositoryHash = hashValue(identity.repositoryKey.toLowerCase());
  const cacheIdentity = JSON.stringify({
    cacheIdentitySchemaVersion: CACHE_IDENTITY_SCHEMA_VERSION,
    category,
    commitSha: identity.commitSha,
    engineVersion: ENGINE_VERSION,
    hostedSchemaVersion: HOSTED_SCAN_SCHEMA_VERSION,
    projectPath: identity.projectPath,
    promptVersion: AGENT_PROMPT_VERSION,
    reportSchemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
    repositoryHash,
    rulesetVersion: BUNDLED_RULESET_VERSION,
  });

  return {
    cacheKey: hashValue(cacheIdentity),
    category,
    commitSha: identity.commitSha,
    engineVersion: ENGINE_VERSION,
    projectPath: identity.projectPath,
    repositoryHash,
    rulesetVersion: BUNDLED_RULESET_VERSION,
  };
};

const executeCacheRead: ExecuteCacheRead = async (cacheKey) => {
  const database = getDatabase();
  return database.$client`
    select payload
    from public.get_shadscan_scan_cache(${cacheKey})
  `;
};

const executeCacheWrite: ExecuteCacheWrite = async (
  descriptor,
  response,
  ttlSeconds
) => {
  const database = getDatabase();
  return database.$client`
    select public.put_shadscan_scan_cache(
      ${descriptor.cacheKey},
      ${descriptor.repositoryHash},
      ${descriptor.commitSha},
      ${descriptor.projectPath},
      ${descriptor.category},
      ${descriptor.engineVersion},
      ${descriptor.rulesetVersion},
      ${JSON.stringify(response)}::jsonb,
      ${ttlSeconds}
    )
  `;
};

const createFreshScanId = (): string =>
  `scan_${randomUUID().replaceAll("-", "")}`;

const readScanCache = async (
  identity: ScanCacheIdentity,
  execute: ExecuteCacheRead = executeCacheRead
): Promise<HostedScanResponse | undefined> => {
  const descriptor = createScanCacheDescriptor(identity);
  const rows = CacheRowsSchema.parse(await execute(descriptor.cacheKey));
  const row = rows[0];
  if (!row) {
    return;
  }

  const cachedResponse = HostedScanResponseSchema.parse(row.payload);
  if (!isCurrentCacheResponse(cachedResponse)) {
    return;
  }
  return HostedScanResponseSchema.parse({
    ...cachedResponse,
    scan: {
      ...cachedResponse.scan,
      id: createFreshScanId(),
    },
  });
};

const isCurrentCacheResponse = (response: HostedScanResponse): boolean =>
  response.schemaVersion === HOSTED_SCAN_SCHEMA_VERSION &&
  response.handoff.promptVersion === AGENT_PROMPT_VERSION &&
  response.report.schemaVersion === AUDIT_REPORT_SCHEMA_VERSION &&
  response.scan.engineVersion === ENGINE_VERSION &&
  response.scan.rulesetVersion === BUNDLED_RULESET_VERSION;

const writeScanCache = async (
  identity: ScanCacheIdentity,
  responseInput: HostedScanResponse,
  ttlSeconds: number,
  execute: ExecuteCacheWrite = executeCacheWrite
): Promise<void> => {
  const response = HostedScanResponseSchema.parse(responseInput);
  if (!isCurrentCacheResponse(response)) {
    return;
  }
  await execute(createScanCacheDescriptor(identity), response, ttlSeconds);
};

const readScanCacheFailOpen = async (
  config: ScanCacheConfig,
  identity: ScanCacheIdentity,
  execute?: ExecuteCacheRead
): Promise<HostedScanResponse | undefined> => {
  if (!config.enabled) {
    return;
  }
  try {
    return await readScanCache(identity, execute);
  } catch {
    return;
  }
};

const writeScanCacheFailOpen = async (
  config: ScanCacheConfig,
  identity: ScanCacheIdentity,
  response: HostedScanResponse,
  execute?: ExecuteCacheWrite
): Promise<void> => {
  if (!config.enabled) {
    return;
  }
  try {
    await writeScanCache(identity, response, config.ttlSeconds, execute);
  } catch {
    // Cache writes are an optimization and must not fail a completed scan.
  }
};

export type {
  ExecuteCacheRead,
  ExecuteCacheWrite,
  ScanCacheConfig,
  ScanCacheDescriptor,
  ScanCacheEnvironment,
  ScanCacheIdentity,
};
export {
  CACHE_IDENTITY_SCHEMA_VERSION,
  createScanCacheDescriptor,
  DEFAULT_CACHE_TTL_HOURS,
  getScanCacheConfig,
  MAX_CACHE_TTL_HOURS,
  readScanCache,
  readScanCacheFailOpen,
  writeScanCache,
  writeScanCacheFailOpen,
};
