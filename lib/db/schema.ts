import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
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

export { rateLimitWindows };
