import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeDatabaseRateLimits,
  DATABASE_RATE_LIMIT_TRANSPORT_TIMEOUT_MS,
  DatabaseRateLimitError,
  type DatabaseRateLimitRule,
  hashRateLimitIdentity,
} from "../../lib/rate-limit/database";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

const RULES: readonly DatabaseRateLimitRule[] = [
  {
    bucket: "web-client-short",
    identityHash: "a".repeat(64),
    maxRequests: 3,
    name: "clientShort",
    windowMs: 600_000,
  },
  {
    bucket: "web-client-daily",
    identityHash: "a".repeat(64),
    maxRequests: 20,
    name: "clientDaily",
    windowMs: 86_400_000,
  },
];

afterEach(() => {
  vi.useRealTimers();
});

describe("database rate-limit contract", () => {
  it("returns validated decisions in requested rule order", async () => {
    const execute = vi.fn(() =>
      Promise.resolve([
        {
          allowed: true,
          max_requests: 20,
          remaining: 19,
          reset_at_ms: "86401000",
          rule_name: "clientDaily",
        },
        {
          allowed: true,
          max_requests: 3,
          remaining: 2,
          reset_at_ms: 601_000,
          rule_name: "clientShort",
        },
      ])
    );

    await expect(consumeDatabaseRateLimits(RULES, execute)).resolves.toEqual([
      {
        allowed: true,
        limit: 3,
        name: "clientShort",
        remaining: 2,
        resetAt: 601_000,
      },
      {
        allowed: true,
        limit: 20,
        name: "clientDaily",
        remaining: 19,
        resetAt: 86_401_000,
      },
    ]);
    expect(execute).toHaveBeenCalledWith(RULES, expect.anything());
  });

  it("rejects incomplete or inconsistent database responses", async () => {
    await expect(
      consumeDatabaseRateLimits(RULES, () => Promise.resolve([]))
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(
      consumeDatabaseRateLimits(RULES, () =>
        Promise.resolve([
          {
            allowed: true,
            max_requests: 4,
            remaining: 3,
            reset_at_ms: 601_000,
            rule_name: "clientShort",
          },
          {
            allowed: true,
            max_requests: 20,
            remaining: 19,
            reset_at_ms: 86_401_000,
            rule_name: "clientDaily",
          },
        ])
      )
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("validates internal rules before calling the database", async () => {
    const execute = vi.fn(() => Promise.resolve([]));

    await expect(
      consumeDatabaseRateLimits(
        [{ ...RULES[0], identityHash: "raw-client-address" }],
        execute
      )
    ).rejects.toBeInstanceOf(DatabaseRateLimitError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("aborts a stalled database request within its transport deadline", async () => {
    vi.useFakeTimers();
    let executionSignal: AbortSignal | undefined;
    const outcome = consumeDatabaseRateLimits(
      RULES,
      (_rules, signal) => {
        executionSignal = signal;
        return new Promise<never>(() => undefined);
      },
      100
    ).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(100);

    await expect(outcome).resolves.toMatchObject({ code: "UNAVAILABLE" });
    expect(executionSignal?.aborted).toBe(true);
  });

  it("keeps the database deadline inside the hosted scan budget", () => {
    expect(DATABASE_RATE_LIMIT_TRANSPORT_TIMEOUT_MS).toBe(5000);
    expect(DATABASE_RATE_LIMIT_TRANSPORT_TIMEOUT_MS).toBeLessThan(25_000);
  });

  it("hashes identities deterministically and namespaces collisions", () => {
    const clientHash = hashRateLimitIdentity("client", "203.0.113.4");

    expect(clientHash).toMatch(SHA256_HEX_PATTERN);
    expect(clientHash).not.toContain("203.0.113.4");
    expect(hashRateLimitIdentity("client", "203.0.113.4")).toBe(clientHash);
    expect(hashRateLimitIdentity("repository", "203.0.113.4")).not.toBe(
      clientHash
    );
  });
});
