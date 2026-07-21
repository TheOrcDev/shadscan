import { afterEach, describe, expect, it } from "vitest";
import {
  checkMemoryWebDiscoveryRateLimit,
  resetMemoryWebDiscoveryRateLimits,
  WEB_DISCOVERY_RATE_LIMIT,
} from "../../lib/shadscan-web/discovery-rate-limit";

afterEach(() => {
  resetMemoryWebDiscoveryRateLimits();
});

describe("web project discovery rate limit", () => {
  it("uses a separate lightweight client budget", () => {
    const input = {
      clientAddress: "203.0.113.4",
      repositoryKey: "acme/monorepo",
    };
    const now = Date.parse("2026-07-22T10:00:00.000Z");

    for (
      let requestIndex = 0;
      requestIndex < WEB_DISCOVERY_RATE_LIMIT.limit;
      requestIndex += 1
    ) {
      expect(() => checkMemoryWebDiscoveryRateLimit(input, now)).not.toThrow();
    }

    expect(() => checkMemoryWebDiscoveryRateLimit(input, now)).toThrow(
      expect.objectContaining({
        code: "RATE_LIMITED",
        retryable: true,
      })
    );
  });
});
