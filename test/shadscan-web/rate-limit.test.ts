import { afterEach, describe, expect, it } from "vitest";
import {
  checkMemoryWebRateLimit,
  getClientRateLimitKey,
  resetMemoryWebRateLimits,
  WEB_RATE_LIMITS,
} from "../../lib/shadscan-web/rate-limit";

const TEST_SALT = "a-secure-test-rate-limit-salt-value";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

afterEach(() => {
  resetMemoryWebRateLimits();
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

  it("allows three client scans per short window and rejects the fourth", () => {
    const input = {
      clientAddress: "203.0.113.4",
      repositoryKey: "acme/widget",
    };

    for (let count = 0; count < WEB_RATE_LIMITS.clientShort.limit; count += 1) {
      expect(
        checkMemoryWebRateLimit(input, 1000, TEST_SALT, "test")
      ).toHaveLength(3);
    }

    expect(() =>
      checkMemoryWebRateLimit(input, 1000, TEST_SALT, "test")
    ).toThrowError(
      expect.objectContaining({
        code: "RATE_LIMITED",
        retryAfterSeconds: 600,
      })
    );
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
        { clientAddress: "198.51.100.1", repositoryKey },
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
  });
});
