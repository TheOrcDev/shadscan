import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const rateLimitWindows = pgTable(
  "rate_limit_windows",
  {
    bucket: text("bucket").notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    identityHash: text("identity_hash").notNull(),
    requestCount: integer("request_count").notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    windowStartedAt: timestamp("window_started_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.bucket, table.identityHash, table.windowStartedAt],
      name: "rate_limit_windows_pkey",
    }),
    index("rate_limit_windows_expires_at_idx").on(table.expiresAt),
    check(
      "rate_limit_windows_identity_hash_check",
      sql`char_length(${table.identityHash}) = 64`
    ),
    check(
      "rate_limit_windows_request_count_check",
      sql`${table.requestCount} >= 0`
    ),
  ]
);

const scanCache = pgTable(
  "scan_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    category: text("category").notNull(),
    commitSha: text("commit_sha").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    engineVersion: text("engine_version").notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    payload: jsonb("payload").notNull(),
    projectPath: text("project_path").notNull(),
    repositoryHash: text("repository_hash").notNull(),
    rulesetVersion: text("ruleset_version").notNull(),
  },
  (table) => [
    index("scan_cache_expires_at_idx").on(table.expiresAt),
    check(
      "scan_cache_cache_key_check",
      sql`char_length(${table.cacheKey}) = 64`
    ),
    check(
      "scan_cache_repository_hash_check",
      sql`char_length(${table.repositoryHash}) = 64`
    ),
    check(
      "scan_cache_commit_sha_check",
      sql`char_length(${table.commitSha}) = 40`
    ),
    check(
      "scan_cache_project_path_check",
      sql`char_length(${table.projectPath}) between 1 and 512`
    ),
  ]
);

const scanJobs = pgTable(
  "scan_jobs",
  {
    attempts: integer("attempts").default(0).notNull(),
    cacheKey: text("cache_key").notNull(),
    category: text("category").notNull(),
    commitSha: text("commit_sha").notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    jobId: uuid("job_id").primaryKey(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      mode: "date",
      withTimezone: true,
    }),
    projectPath: text("project_path").notNull(),
    repositoryHash: text("repository_hash").notNull(),
    resultCacheKey: text("result_cache_key"),
    state: text("state").notNull(),
    terminalError: jsonb("terminal_error"),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    uniqueIndex("scan_jobs_cache_key_unique").on(table.cacheKey),
    index("scan_jobs_expires_at_idx").on(table.expiresAt),
    index("scan_jobs_state_lease_idx").on(table.state, table.leaseExpiresAt),
    check(
      "scan_jobs_cache_key_check",
      sql`char_length(${table.cacheKey}) = 64`
    ),
    check(
      "scan_jobs_repository_hash_check",
      sql`char_length(${table.repositoryHash}) = 64`
    ),
    check(
      "scan_jobs_commit_sha_check",
      sql`char_length(${table.commitSha}) = 40`
    ),
    check(
      "scan_jobs_project_path_check",
      sql`char_length(${table.projectPath}) between 1 and 512`
    ),
    check(
      "scan_jobs_state_check",
      sql`${table.state} in ('queued', 'running', 'completed', 'failed')`
    ),
    check("scan_jobs_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "scan_jobs_result_cache_key_check",
      sql`${table.resultCacheKey} IS NULL OR char_length(${table.resultCacheKey}) = 64`
    ),
    check(
      "scan_jobs_terminal_error_check",
      sql`${table.terminalError} IS NULL OR jsonb_typeof(${table.terminalError}) = 'object'`
    ),
  ]
);

const scanJobAccess = pgTable(
  "scan_job_access",
  {
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => scanJobs.jobId, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    tokenHash: text("token_hash").primaryKey(),
  },
  (table) => [
    index("scan_job_access_job_id_idx").on(table.jobId),
    index("scan_job_access_expires_at_idx").on(table.expiresAt),
    check(
      "scan_job_access_token_hash_check",
      sql`char_length(${table.tokenHash}) = 64`
    ),
  ]
);

export { rateLimitWindows, scanCache, scanJobAccess, scanJobs };
