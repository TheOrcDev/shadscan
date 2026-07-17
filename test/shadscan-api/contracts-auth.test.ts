import {
  AGENT_PROMPT_VERSION,
  AUDIT_CATEGORIES,
  AUDIT_REPORT_SCHEMA_VERSION,
} from "shadscan";
import { describe, expect, it, vi } from "vitest";
import {
  authenticateApiRequest,
  hashApiKey,
} from "../../lib/shadscan-api/auth";
import {
  GitHubScanRequestSchema,
  GitHubSourceSchema,
  PortableSubdirectorySchema,
  SnapshotScanQuerySchema,
} from "../../lib/shadscan-api/contracts";
import {
  HOSTED_AUDIT_CATEGORIES,
  PUBLIC_CONTRACT_VERSIONS,
} from "../../lib/shadscan-api/protocol";
import { enforceRateLimit } from "../../lib/shadscan-api/rate-limit";

const VALID_API_KEY = "shadscan_beta_abcdefghijklmnopqrstuvwxyz0123456789";
const VALID_API_KEY_HASHES = JSON.stringify({
  beta: hashApiKey(VALID_API_KEY),
});

const createAuthenticatedRequest = (authorization?: string): Request =>
  new Request("https://shadscan.dev/v1/scans", {
    headers: authorization === undefined ? {} : { authorization },
  });

const restoreEnvironmentValue = (
  name:
    | "SHADSCAN_RATE_LIMIT_MODE"
    | "UPSTASH_REDIS_REST_TOKEN"
    | "UPSTASH_REDIS_REST_URL",
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
  });

  it.each([
    ".",
    "apps/web",
    "packages/design-system/src",
  ])("accepts a portable project subdirectory: %s", (subdirectory) => {
    expect(PortableSubdirectorySchema.parse(subdirectory)).toBe(subdirectory);
  });

  it.each([
    "",
    "/apps/web",
    "../apps/web",
    "apps/../web",
    "apps/./web",
    "apps//web",
    "apps\\web",
    "C:/apps/web",
  ])("rejects a non-portable project subdirectory: %s", (subdirectory) => {
    expect(PortableSubdirectorySchema.safeParse(subdirectory).success).toBe(
      false
    );
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
  it("cannot enable the process-local limiter in production", async () => {
    const originalEnvironment = {
      rateLimitMode: process.env.SHADSCAN_RATE_LIMIT_MODE,
      redisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
      redisUrl: process.env.UPSTASH_REDIS_REST_URL,
    };

    try {
      vi.stubEnv("NODE_ENV", "production");
      process.env.SHADSCAN_RATE_LIMIT_MODE = "memory";
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.UPSTASH_REDIS_REST_URL;

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
      restoreEnvironmentValue(
        "UPSTASH_REDIS_REST_TOKEN",
        originalEnvironment.redisToken
      );
      restoreEnvironmentValue(
        "UPSTASH_REDIS_REST_URL",
        originalEnvironment.redisUrl
      );
    }
  });
});
