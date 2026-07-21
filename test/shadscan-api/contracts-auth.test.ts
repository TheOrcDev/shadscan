import {
  AGENT_PROMPT_VERSION,
  AUDIT_CATEGORIES,
  AUDIT_REPORT_SCHEMA_VERSION,
} from "@shadscan/cli";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseRateLimitRule } from "../../lib/rate-limit/database";
import {
  authenticateApiRequest,
  hashApiKey,
} from "../../lib/shadscan-api/auth";
import {
  CompletedHostedScanSchema,
  GitHubScanRequestSchema,
  GitHubSourceSchema,
  PortableSubdirectorySchema,
  SnapshotScanQuerySchema,
} from "../../lib/shadscan-api/contracts";
import { HostedScanError } from "../../lib/shadscan-api/errors";
import { OPENAPI_DOCUMENT } from "../../lib/shadscan-api/openapi";
import {
  HOSTED_AUDIT_CATEGORIES,
  PUBLIC_CONTRACT_VERSIONS,
} from "../../lib/shadscan-api/protocol";
import {
  checkDatabaseRateLimit,
  checkMemoryRateLimit,
  enforceRateLimit,
  getRateLimitHeaders,
  resetMemoryRateLimits,
} from "../../lib/shadscan-api/rate-limit";

const VALID_API_KEY = "shadscan_beta_abcdefghijklmnopqrstuvwxyz0123456789";
const VALID_API_KEY_HASHES = JSON.stringify({
  beta: hashApiKey(VALID_API_KEY),
});
const OPENAPI_GITHUB_REVISION_PATTERN = new RegExp(
  OPENAPI_DOCUMENT.components.schemas.GitHubSource.properties.revision.pattern
);
const OPENAPI_SUBDIRECTORY_PATTERN = new RegExp(
  OPENAPI_DOCUMENT.components.schemas.PortableSubdirectory.pattern
);
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

const createAuthenticatedRequest = (authorization?: string): Request =>
  new Request("https://www.shadscan.com/v1/scans", {
    headers: authorization === undefined ? {} : { authorization },
  });

const restoreEnvironmentValue = (
  name: "DATABASE_URL" | "SHADSCAN_RATE_LIMIT_MODE",
  value: string | undefined
): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
};

describe("hosted scan request contracts", () => {
  it("keeps hosted categories and versions aligned with the scanner", () => {
    expect(HOSTED_AUDIT_CATEGORIES).toEqual(AUDIT_CATEGORIES);
    expect(PUBLIC_CONTRACT_VERSIONS).toEqual({
      prompt: AGENT_PROMPT_VERSION,
      report: AUDIT_REPORT_SCHEMA_VERSION,
      scan: 1,
    });
  });

  it("accepts a bounded GitHub source and applies portable defaults", () => {
    expect(
      GitHubScanRequestSchema.parse({
        category: "accessibility",
        source: {
          kind: "github",
          repository: "TheOrcDev/headless-shadcn",
        },
      })
    ).toEqual({
      category: "accessibility",
      source: {
        kind: "github",
        repository: "TheOrcDev/headless-shadcn",
        revision: "HEAD",
        subdirectory: ".",
      },
    });
  });

  it.each([
    "https://github.com/TheOrcDev/headless-shadcn",
    "owner",
    "owner/repository/extra",
    "-owner/repository",
    "owner-/repository",
    "owner/repository name",
  ])("rejects an unsafe or non-canonical GitHub repository: %s", (repository) => {
    expect(
      GitHubSourceSchema.safeParse({
        kind: "github",
        repository,
      }).success
    ).toBe(false);
  });

  it.each([
    "../main",
    "refs//heads/main",
    "/main",
    "main/",
    "main.lock",
    "main@{1}",
    "main with spaces",
  ])("rejects an unsafe GitHub revision: %s", (revision) => {
    expect(
      GitHubSourceSchema.safeParse({
        kind: "github",
        repository: "owner/repository",
        revision,
      }).success
    ).toBe(false);
    expect(revision).not.toMatch(OPENAPI_GITHUB_REVISION_PATTERN);
  });

  it.each([
    ".",
    "apps/web",
    "packages/design-system/src",
  ])("accepts a portable project subdirectory: %s", (subdirectory) => {
    expect(PortableSubdirectorySchema.parse(subdirectory)).toBe(subdirectory);
    expect(subdirectory).toMatch(OPENAPI_SUBDIRECTORY_PATTERN);
  });

  it.each([
    "",
    "/apps/web",
    "../apps/web",
    "apps/../web",
    "apps/./web",
    "apps//web",
    "apps\\web",
    "apps/\0web",
    "C:/apps/web",
  ])("rejects a non-portable project subdirectory: %s", (subdirectory) => {
    expect(PortableSubdirectorySchema.safeParse(subdirectory).success).toBe(
      false
    );
    expect(subdirectory).not.toMatch(OPENAPI_SUBDIRECTORY_PATTERN);
  });

  it("rejects unknown request and query fields", () => {
    expect(
      GitHubScanRequestSchema.safeParse({
        source: {
          kind: "github",
          repository: "owner/repository",
        },
        unexpected: true,
      }).success
    ).toBe(false);
    expect(
      SnapshotScanQuerySchema.safeParse({
        category: "accessibility",
        subdirectory: ".",
        unexpected: true,
      }).success
    ).toBe(false);
  });

  it("requires an immutable commit SHA or null in completed scan metadata", () => {
    const completedScan = {
      engineVersion: "0.0.1",
      id: "scan_0123456789abcdef0123456789abcdef",
      resolvedRevision: "0123456789abcdef0123456789abcdef01234567",
      rulesetVersion: "2026.07.2",
      sourceDigest:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "completed",
    };

    expect(CompletedHostedScanSchema.safeParse(completedScan).success).toBe(
      true
    );
    expect(
      CompletedHostedScanSchema.safeParse({
        ...completedScan,
        resolvedRevision: "main",
      }).success
    ).toBe(false);
    expect(
      CompletedHostedScanSchema.safeParse({
        ...completedScan,
        resolvedRevision: null,
      }).success
    ).toBe(true);
  });
});

describe("hosted API Bearer authentication", () => {
  it("authenticates a hashed API key without exposing the secret", () => {
    const request = createAuthenticatedRequest(`Bearer ${VALID_API_KEY}`);

    expect(authenticateApiRequest(request, VALID_API_KEY_HASHES)).toEqual({
      keyId: "beta",
    });
    expect(VALID_API_KEY_HASHES).not.toContain(VALID_API_KEY);
  });

  it.each([
    undefined,
    "Basic credentials",
    "Bearer",
    "Bearer malformed",
    `Bearer ${VALID_API_KEY} extra`,
    "Bearer shadscan_unknown_abcdefghijklmnopqrstuvwxyz0123456789",
    "Bearer shadscan_beta_abcdefghijklmnopqrstuvwxyz9876543210",
  ])("rejects a missing or malformed credential: %s", (authorization) => {
    expect(() =>
      authenticateApiRequest(
        createAuthenticatedRequest(authorization),
        VALID_API_KEY_HASHES
      )
    ).toThrowError(
      expect.objectContaining({
        code: "UNAUTHORIZED",
        status: 401,
      })
    );
  });

  it.each([
    undefined,
    "not-json",
    "{}",
    JSON.stringify({ beta: "not-a-sha256-hash" }),
  ])("fails closed when key hashes are not configured: %s", (configuration) => {
    expect(() =>
      authenticateApiRequest(
        createAuthenticatedRequest(`Bearer ${VALID_API_KEY}`),
        configuration
      )
    ).toThrowError(
      expect.objectContaining({
        code: "AUTH_NOT_CONFIGURED",
        status: 503,
      })
    );
  });
});

describe("hosted API production limiting", () => {
  it("never emits a negative reset duration for a completed request", () => {
    expect(
      getRateLimitHeaders({ limit: 10, remaining: 9, resetAt: 1000 }, 2000)
    ).toMatchObject({ "RateLimit-Reset": "0" });
  });

  it("maps hosted limits to one hashed API-key identity", async () => {
    const consume = vi.fn((rules: readonly DatabaseRateLimitRule[]) =>
      Promise.resolve(
        rules.map((rule) => ({
          allowed: true,
          limit: rule.maxRequests,
          name: rule.name,
          remaining: rule.maxRequests - 1,
          resetAt: 90_000_000,
        }))
      )
    );

    await expect(
      checkDatabaseRateLimit("beta", 1000, consume)
    ).resolves.toEqual({
      limit: 10,
      remaining: 9,
      resetAt: 90_000_000,
    });

    const rules = consume.mock.calls[0][0];
    expect(rules.map((rule) => rule.name)).toEqual(["minute", "daily"]);
    expect(rules[0].identityHash).toMatch(SHA256_HEX_PATTERN);
    expect(rules[0].identityHash).toBe(rules[1].identityHash);
  });

  it("does not consume daily quota when the minute limit rejects", () => {
    const startedAt = 1000;
    resetMemoryRateLimits();

    for (let count = 0; count < 10; count += 1) {
      expect(checkMemoryRateLimit("beta", startedAt)).toBeDefined();
    }
    for (let count = 0; count < 90; count += 1) {
      expect(() => checkMemoryRateLimit("beta", startedAt)).toThrowError(
        expect.objectContaining({ code: "RATE_LIMITED" })
      );
    }

    expect(() =>
      checkMemoryRateLimit("beta", startedAt + 60_001)
    ).not.toThrow();
    resetMemoryRateLimits();
  });

  it("retries when the last denied database rule becomes eligible", async () => {
    const consume = vi.fn(() =>
      Promise.resolve([
        {
          allowed: false,
          limit: 10,
          name: "minute",
          remaining: 0,
          resetAt: 61_000,
        },
        {
          allowed: false,
          limit: 100,
          name: "daily",
          remaining: 0,
          resetAt: 86_401_000,
        },
      ])
    );

    try {
      await checkDatabaseRateLimit("beta", 1000, consume);
      expect.fail("Expected the database limiter to reject the request.");
    } catch (error) {
      expect(error).toBeInstanceOf(HostedScanError);
      if (!(error instanceof HostedScanError)) {
        throw error;
      }
      expect(error.code).toBe("RATE_LIMITED");
      expect(error.headers.get("retry-after")).toBe("86400");
    }
  });

  it("cannot enable the process-local limiter in production", async () => {
    const originalEnvironment = {
      databaseUrl: process.env.DATABASE_URL,
      rateLimitMode: process.env.SHADSCAN_RATE_LIMIT_MODE,
    };

    try {
      vi.stubEnv("NODE_ENV", "production");
      process.env.SHADSCAN_RATE_LIMIT_MODE = "memory";
      delete process.env.DATABASE_URL;

      await expect(enforceRateLimit("production-key")).rejects.toMatchObject({
        code: "RATE_LIMIT_NOT_CONFIGURED",
        status: 503,
      });
    } finally {
      vi.unstubAllEnvs();
      restoreEnvironmentValue(
        "SHADSCAN_RATE_LIMIT_MODE",
        originalEnvironment.rateLimitMode
      );
      restoreEnvironmentValue("DATABASE_URL", originalEnvironment.databaseUrl);
    }
  });
});
