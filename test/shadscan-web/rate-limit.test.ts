import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseRateLimitRule } from "../../lib/rate-limit/database";
import {
  checkDatabaseWebRateLimit,
  checkMemoryWebRateLimit,
  enforceWebScanRateLimit,
  getClientRateLimitKey,
  resetMemoryWebRateLimits,
  WEB_RATE_LIMITS,
} from "../../lib/shadscan-web/rate-limit";

const TEST_SALT = "a-secure-test-rate-limit-salt-value";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

afterEach(() => {
  resetMemoryWebRateLimits();
  vi.unstubAllEnvs();
});

describe("web scan rate limits", () => {
  it("hashes client addresses without storing the raw value", () => {
    const key = getClientRateLimitKey("203.0.113.4", TEST_SALT, "production");

    expect(key).toMatch(SHA256_HEX_PATTERN);
    expect(key).not.toContain("203.0.113.4");
    expect(getClientRateLimitKey("203.0.113.4", TEST_SALT, "production")).toBe(
      key
    );
  });

  it("fails closed when production has no sufficiently long HMAC salt", () => {
    expect(() =>
      getClientRateLimitKey("203.0.113.4", undefined, "production")
    ).toThrowError(
      expect.objectContaining({
        code: "SERVICE_NOT_CONFIGURED",
      })
    );
    expect(() =>
      getClientRateLimitKey("203.0.113.4", "short", "production")
    ).toThrowError(
      expect.objectContaining({
        code: "SERVICE_NOT_CONFIGURED",
      })
    );
  });

  it("fails closed through the production limiter when configuration is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SHADSCAN_WEB_RATE_LIMIT_SALT", "");

    await expect(
      enforceWebScanRateLimit({
        clientAddress: "203.0.113.4",
        repositoryKey: "acme/widget",
      })
    ).rejects.toMatchObject({ code: "SERVICE_NOT_CONFIGURED" });
  });

  it("uses predictable in-memory limits in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SHADSCAN_WEB_RATE_LIMIT_MODE", "");

    await expect(
      enforceWebScanRateLimit({
        clientAddress: "203.0.113.4",
        repositoryKey: "acme/widget",
      })
    ).resolves.toHaveLength(3);
  });

  it("maps public limits to hashed database rules", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SHADSCAN_WEB_RATE_LIMIT_SALT", TEST_SALT);
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
      checkDatabaseWebRateLimit(
        {
          clientAddress: "203.0.113.4",
          repositoryKey: "acme/widget",
        },
        1000,
        consume
      )
    ).resolves.toHaveLength(3);

    const rules = consume.mock.calls[0][0];
    expect(rules.map((rule) => rule.name)).toEqual([
      "clientDaily",
      "clientShort",
      "repositoryDaily",
    ]);
    expect(rules.map((rule) => rule.maxRequests)).toEqual([20, 10, 10]);
    expect(
      rules.every((rule) => SHA256_HEX_PATTERN.test(rule.identityHash))
    ).toBe(true);
    expect(rules[0].identityHash).toBe(rules[1].identityHash);
    expect(rules[2].identityHash).not.toBe(rules[0].identityHash);
  });

  it("allows ten client scans per short window and rejects the eleventh", () => {
    const rejectedRepository = "acme/widget-over-limit";
    for (let count = 0; count < WEB_RATE_LIMITS.clientShort.limit; count += 1) {
      expect(
        checkMemoryWebRateLimit(
          {
            clientAddress: "203.0.113.4",
            repositoryKey: `acme/widget-${count}`,
          },
          1000,
          TEST_SALT,
          "test"
        )
      ).toHaveLength(3);
    }

    expect(() =>
      checkMemoryWebRateLimit(
        {
          clientAddress: "203.0.113.4",
          repositoryKey: rejectedRepository,
        },
        1000,
        TEST_SALT,
        "test"
      )
    ).toThrowError(
      expect.objectContaining({
        code: "RATE_LIMITED",
        retryAfterSeconds: 600,
      })
    );

    for (
      let count = 0;
      count < WEB_RATE_LIMITS.repositoryDaily.limit;
      count += 1
    ) {
      expect(
        checkMemoryWebRateLimit(
          {
            clientAddress: `198.51.100.${count}`,
            repositoryKey: rejectedRepository,
          },
          1000,
          TEST_SALT,
          "test"
        )
      ).toHaveLength(3);
    }

    expect(() =>
      checkMemoryWebRateLimit(
        {
          clientAddress: "203.0.113.4",
          repositoryKey: "acme/boundary",
        },
        600_000,
        TEST_SALT,
        "test"
      )
    ).toThrowError(expect.objectContaining({ code: "RATE_LIMITED" }));
    expect(() =>
      checkMemoryWebRateLimit(
        {
          clientAddress: "203.0.113.4",
          repositoryKey: "acme/after-boundary",
        },
        600_001,
        TEST_SALT,
        "test"
      )
    ).not.toThrow();
  });

  it("limits repeated repository scans across distinct clients", () => {
    const repositoryKey = "acme/widget";
    for (
      let count = 0;
      count < WEB_RATE_LIMITS.repositoryDaily.limit;
      count += 1
    ) {
      checkMemoryWebRateLimit(
        {
          clientAddress: `203.0.113.${count}`,
          repositoryKey,
        },
        1000,
        TEST_SALT,
        "test"
      );
    }

    expect(() =>
      checkMemoryWebRateLimit(
        { clientAddress: "198.51.100.200", repositoryKey },
        1000,
        TEST_SALT,
        "test"
      )
    ).toThrowError(
      expect.objectContaining({
        code: "RATE_LIMITED",
        retryAfterSeconds: 86_400,
      })
    );

    for (let count = 0; count < WEB_RATE_LIMITS.clientShort.limit; count += 1) {
      expect(
        checkMemoryWebRateLimit(
          {
            clientAddress: "198.51.100.200",
            repositoryKey: `acme/other-${count}`,
          },
          1000,
          TEST_SALT,
          "test"
        )
      ).toHaveLength(3);
    }
  });
});
