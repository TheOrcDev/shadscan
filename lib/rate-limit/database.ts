import { createHash } from "node:crypto";
import { z } from "zod";
import { DatabaseConfigurationError, getDatabase } from "../db/client";

const MAXIMUM_RULES_PER_CHECK = 8;
const DATABASE_RATE_LIMIT_LOCK_TIMEOUT_MS = 1000;
const DATABASE_RATE_LIMIT_STATEMENT_TIMEOUT_MS = 3000;
const DATABASE_RATE_LIMIT_TRANSPORT_TIMEOUT_MS = 5000;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

interface DatabaseRateLimitRule {
  bucket: string;
  identityHash: string;
  maxRequests: number;
  name: string;
  windowMs: number;
}

interface DatabaseRateLimitDecision {
  allowed: boolean;
  limit: number;
  name: string;
  remaining: number;
  resetAt: number;
}

type DatabaseRateLimitErrorCode = "NOT_CONFIGURED" | "UNAVAILABLE";

class DatabaseRateLimitError extends Error {
  readonly code: DatabaseRateLimitErrorCode;

  constructor(
    message: string,
    options: { cause?: unknown; code: DatabaseRateLimitErrorCode }
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "DatabaseRateLimitError";
    this.code = options.code;
  }
}

type ExecuteDatabaseRateLimits = (
  rules: readonly DatabaseRateLimitRule[],
  signal: AbortSignal
) => Promise<readonly unknown[]>;

const DatabaseRateLimitRowSchema = z.object({
  allowed: z.boolean(),
  max_requests: z.number().int().positive(),
  remaining: z.number().int().nonnegative(),
  reset_at_ms: z.coerce.number().int().nonnegative(),
  rule_name: z.string().min(1),
});

const assertValidRules = (rules: readonly DatabaseRateLimitRule[]): void => {
  if (rules.length === 0 || rules.length > MAXIMUM_RULES_PER_CHECK) {
    throw new DatabaseRateLimitError("The rate-limit rule set is invalid.", {
      code: "UNAVAILABLE",
    });
  }

  const names = new Set<string>();
  for (const rule of rules) {
    const validRule =
      rule.bucket.length > 0 &&
      rule.bucket.length <= 128 &&
      SHA256_HEX_PATTERN.test(rule.identityHash) &&
      Number.isSafeInteger(rule.maxRequests) &&
      rule.maxRequests > 0 &&
      rule.name.length > 0 &&
      rule.name.length <= 128 &&
      Number.isSafeInteger(rule.windowMs) &&
      rule.windowMs >= 1000 &&
      rule.windowMs <= 604_800_000;
    if (!validRule || names.has(rule.name)) {
      throw new DatabaseRateLimitError("The rate-limit rule set is invalid.", {
        code: "UNAVAILABLE",
      });
    }
    names.add(rule.name);
  }
};

const executeDatabaseRateLimits: ExecuteDatabaseRateLimits = async (
  rules,
  signal
) => {
  let database: ReturnType<typeof getDatabase>;
  try {
    database = getDatabase();
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) {
      throw new DatabaseRateLimitError(
        "Distributed rate limiting is not configured.",
        { cause: error, code: "NOT_CONFIGURED" }
      );
    }
    throw error;
  }

  const payload = rules.map((rule) => ({
    bucket: rule.bucket,
    identityHash: rule.identityHash,
    maxRequests: rule.maxRequests,
    ruleName: rule.name,
    windowMs: rule.windowMs,
  }));

  try {
    const transactionResults = await database.$client.transaction(
      (transaction) => [
        transaction`select set_config('lock_timeout', ${`${DATABASE_RATE_LIMIT_LOCK_TIMEOUT_MS}ms`}, true)`,
        transaction`select set_config('statement_timeout', ${`${DATABASE_RATE_LIMIT_STATEMENT_TIMEOUT_MS}ms`}, true)`,
        transaction`select * from consume_shadscan_rate_limits(${JSON.stringify(
          payload
        )}::jsonb)`,
      ],
      { fetchOptions: { signal } }
    );
    return transactionResults[2] ?? [];
  } catch (error) {
    throw new DatabaseRateLimitError(
      "The distributed rate limiter is unavailable.",
      { cause: error, code: "UNAVAILABLE" }
    );
  }
};

const consumeDatabaseRateLimits = async (
  rules: readonly DatabaseRateLimitRule[],
  execute: ExecuteDatabaseRateLimits = executeDatabaseRateLimits,
  timeoutMs = DATABASE_RATE_LIMIT_TRANSPORT_TIMEOUT_MS
): Promise<DatabaseRateLimitDecision[]> => {
  assertValidRules(rules);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new DatabaseRateLimitError(
      "The database rate-limit timeout is invalid.",
      { code: "UNAVAILABLE" }
    );
  }

  const controller = new AbortController();
  const timeoutError = new DatabaseRateLimitError(
    "The distributed rate limiter timed out.",
    { code: "UNAVAILABLE" }
  );
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  let parsedRows: z.infer<typeof DatabaseRateLimitRowSchema>[];
  try {
    parsedRows = z
      .array(DatabaseRateLimitRowSchema)
      .parse(await Promise.race([execute(rules, controller.signal), timeout]));
  } catch (error) {
    if (error instanceof DatabaseRateLimitError) {
      throw error;
    }
    throw new DatabaseRateLimitError(
      "The distributed rate limiter returned an invalid response.",
      { cause: error, code: "UNAVAILABLE" }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const rowsByName = new Map(parsedRows.map((row) => [row.rule_name, row]));
  if (rowsByName.size !== rules.length) {
    throw new DatabaseRateLimitError(
      "The distributed rate limiter returned an incomplete response.",
      { code: "UNAVAILABLE" }
    );
  }

  return rules.map((rule) => {
    const row = rowsByName.get(rule.name);
    if (!row || row.max_requests !== rule.maxRequests) {
      throw new DatabaseRateLimitError(
        "The distributed rate limiter returned an inconsistent response.",
        { code: "UNAVAILABLE" }
      );
    }
    return {
      allowed: row.allowed,
      limit: row.max_requests,
      name: row.rule_name,
      remaining: row.remaining,
      resetAt: row.reset_at_ms,
    };
  });
};

const hashRateLimitIdentity = (namespace: string, identity: string): string =>
  createHash("sha256")
    .update(`${namespace}\0${identity.trim()}`, "utf8")
    .digest("hex");

export type {
  DatabaseRateLimitDecision,
  DatabaseRateLimitErrorCode,
  DatabaseRateLimitRule,
  ExecuteDatabaseRateLimits,
};
export {
  consumeDatabaseRateLimits,
  DATABASE_RATE_LIMIT_TRANSPORT_TIMEOUT_MS,
  DatabaseRateLimitError,
  hashRateLimitIdentity,
};
