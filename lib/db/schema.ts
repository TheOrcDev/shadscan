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

export { rateLimitWindows, scanCache };
