import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const databaseUrl =
  process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_MIGRATION_URL or DATABASE_URL is required to verify rate limiting."
  );
}

const sql = neon(databaseUrl);
const verificationId = randomUUID();
const bucketPrefix = `verification-${verificationId}`;
const hashIdentity = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");

const consume = (rules) =>
  sql`select * from consume_shadscan_rate_limits(${JSON.stringify(rules)}::jsonb)`;

const primaryRule = {
  bucket: `${bucketPrefix}-concurrent`,
  identityHash: hashIdentity("primary"),
  maxRequests: 5,
  ruleName: "concurrent",
  windowMs: 60_000,
};

try {
  const concurrentResults = await Promise.all(
    Array.from({ length: 10 }, () => consume([primaryRule]))
  );
  const allowedCount = concurrentResults.filter(
    ([decision]) => decision?.allowed
  ).length;
  assert.equal(allowedCount, primaryRule.maxRequests);

  const storedWindows = await sql`
    select request_count
    from rate_limit_windows
    where bucket = ${primaryRule.bucket}
      and identity_hash = ${primaryRule.identityHash}
    order by window_started_at desc
    limit 1
  `;
  assert.equal(storedWindows[0]?.request_count, primaryRule.maxRequests);

  const blockedRule = {
    bucket: `${bucketPrefix}-atomic-blocked`,
    identityHash: hashIdentity("atomic-blocked"),
    maxRequests: 1,
    ruleName: "blocked",
    windowMs: 600_000,
  };
  const companionRule = {
    ...blockedRule,
    bucket: `${bucketPrefix}-atomic-companion`,
    identityHash: hashIdentity("atomic-companion"),
    maxRequests: 5,
    ruleName: "companion",
  };
  await consume([blockedRule]);
  const rejectedBatch = await consume([blockedRule, companionRule]);
  assert.equal(
    rejectedBatch.find((decision) => decision.rule_name === "blocked")?.allowed,
    false
  );
  assert.equal(
    rejectedBatch.find((decision) => decision.rule_name === "companion")
      ?.allowed,
    true
  );

  const companionWindows = await sql`
    select count(*)::integer as count
    from rate_limit_windows
    where bucket = ${companionRule.bucket}
      and identity_hash = ${companionRule.identityHash}
  `;
  assert.equal(companionWindows[0]?.count, 0);

  const blockedWindow = await sql`
    select floor(extract(epoch from window_started_at) * 1000)::bigint as started_at_ms
    from rate_limit_windows
    where bucket = ${blockedRule.bucket}
      and identity_hash = ${blockedRule.identityHash}
    order by window_started_at desc
    limit 1
  `;
  const blockedDecision = rejectedBatch.find(
    (decision) => decision.rule_name === "blocked"
  );
  assert.equal(
    Number(blockedDecision?.reset_at_ms),
    Number(blockedWindow[0]?.started_at_ms) + blockedRule.windowMs + 1
  );

  const independentResults = await consume([
    {
      ...primaryRule,
      identityHash: hashIdentity("independent"),
      ruleName: "independent",
    },
  ]);
  assert.equal(independentResults[0]?.allowed, true);

  const expiredBucket = `${bucketPrefix}-expired`;
  await sql`
    insert into rate_limit_windows (
      bucket,
      expires_at,
      identity_hash,
      request_count,
      updated_at,
      window_started_at
    ) values (
      ${expiredBucket},
      now() - interval '1 day',
      ${hashIdentity("expired")},
      1,
      now() - interval '2 days',
      now() - interval '2 days'
    )
  `;
  await consume([
    {
      ...primaryRule,
      bucket: `${bucketPrefix}-cleanup`,
      identityHash: hashIdentity("cleanup"),
      ruleName: "cleanup",
    },
  ]);
  const expiredRows = await sql`
    select count(*)::integer as count
    from rate_limit_windows
    where bucket = ${expiredBucket}
  `;
  assert.equal(expiredRows[0]?.count, 0);

  console.log(
    `Verified database rate limiting: ${allowedCount}/${concurrentResults.length} concurrent requests allowed.`
  );
} finally {
  await sql`
    delete from rate_limit_windows
    where bucket like ${`${bucketPrefix}%`}
  `;
}
