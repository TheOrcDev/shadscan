import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const migrationUrl = process.env.DATABASE_MIGRATION_URL?.trim();
const runtimeUrl = process.env.DATABASE_URL?.trim();
if (!(migrationUrl && runtimeUrl)) {
  throw new Error(
    "DATABASE_MIGRATION_URL and the restricted runtime DATABASE_URL are required."
  );
}

const ownerSql = neon(migrationUrl);
const runtimeSql = neon(runtimeUrl);
const verificationId = randomUUID();
const bucketPrefix = `verification-${verificationId}`;
const hashIdentity = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const cacheKey = hashIdentity(`cache-${verificationId}`);
const cacheRepositoryHash = hashIdentity(`repository-${verificationId}`);
const cacheCommitSha = createHash("sha1")
  .update(`commit-${verificationId}`, "utf8")
  .digest("hex");
const jobId = randomUUID();
const jobCacheKey = hashIdentity(`job-cache-${verificationId}`);
const jobTokenHash = hashIdentity(`job-token-${verificationId}`);

const consume = (rules) =>
  runtimeSql`select * from consume_shadscan_rate_limits(${JSON.stringify(rules)}::jsonb)`;

const primaryRule = {
  bucket: `${bucketPrefix}-concurrent`,
  identityHash: hashIdentity("primary"),
  maxRequests: 5,
  ruleName: "concurrent",
  windowMs: 60_000,
};

try {
  const ownerIdentity = await ownerSql`select current_user as role_name`;
  const runtimeIdentity = await runtimeSql`
    select
      current_user as role_name,
      has_schema_privilege(current_user, 'public', 'CREATE') as can_create,
      has_table_privilege(
        current_user,
        'public.rate_limit_windows',
        'SELECT'
      ) as can_select,
      has_table_privilege(
        current_user,
        'public.rate_limit_windows',
        'INSERT'
      ) as can_insert,
      has_table_privilege(
        current_user,
        'public.rate_limit_windows',
        'UPDATE'
      ) as can_update,
      has_table_privilege(
        current_user,
        'public.rate_limit_windows',
        'DELETE'
      ) as can_delete,
      has_function_privilege(
        current_user,
        'public.consume_shadscan_rate_limits(jsonb)',
        'EXECUTE'
      ) as can_execute,
      has_table_privilege(
        current_user,
        'public.scan_cache',
        'SELECT'
      ) as can_select_cache,
      has_table_privilege(
        current_user,
        'public.scan_cache',
        'INSERT'
      ) as can_insert_cache,
      has_table_privilege(
        current_user,
        'public.scan_cache',
        'UPDATE'
      ) as can_update_cache,
      has_table_privilege(
        current_user,
        'public.scan_cache',
        'DELETE'
      ) as can_delete_cache,
      has_function_privilege(
        current_user,
        'public.get_shadscan_scan_cache(text)',
        'EXECUTE'
      ) as can_get_cache,
      has_function_privilege(
        current_user,
        'public.put_shadscan_scan_cache(text, text, text, text, text, text, text, jsonb, integer)',
        'EXECUTE'
      ) as can_put_cache,
      not has_table_privilege(current_user, 'public.scan_jobs', 'SELECT')
        and not has_table_privilege(current_user, 'public.scan_jobs', 'INSERT')
        and not has_table_privilege(current_user, 'public.scan_jobs', 'UPDATE')
        and not has_table_privilege(current_user, 'public.scan_jobs', 'DELETE')
        as jobs_are_restricted,
      not has_table_privilege(current_user, 'public.scan_job_access', 'SELECT')
        and not has_table_privilege(current_user, 'public.scan_job_access', 'INSERT')
        and not has_table_privilege(current_user, 'public.scan_job_access', 'UPDATE')
        and not has_table_privilege(current_user, 'public.scan_job_access', 'DELETE')
        as job_access_is_restricted,
      has_function_privilege(
        current_user,
        'public.create_shadscan_scan_job(uuid, text, text, text, text, text, text, integer)',
        'EXECUTE'
      ) as can_create_job,
      has_function_privilege(
        current_user,
        'public.get_shadscan_scan_job(uuid, text)',
        'EXECUTE'
      ) as can_get_job,
      has_function_privilege(
        current_user,
        'public.claim_shadscan_scan_job(uuid, integer, integer, integer)',
        'EXECUTE'
      ) as can_claim_job,
      has_function_privilege(
        current_user,
        'public.complete_shadscan_scan_job(uuid, text)',
        'EXECUTE'
      ) as can_complete_job,
      has_function_privilege(
        current_user,
        'public.record_shadscan_scan_job_failure(uuid, jsonb, boolean, integer)',
        'EXECUTE'
      ) as can_record_job_failure
  `;
  const ownerRole = ownerIdentity[0]?.role_name;
  const runtimeRole = runtimeIdentity[0]?.role_name;
  assert.equal(typeof ownerRole, "string");
  assert.equal(typeof runtimeRole, "string");
  assert.notEqual(runtimeRole, ownerRole);
  assert.equal(runtimeIdentity[0]?.can_create, false);
  assert.equal(runtimeIdentity[0]?.can_select, false);
  assert.equal(runtimeIdentity[0]?.can_insert, false);
  assert.equal(runtimeIdentity[0]?.can_update, false);
  assert.equal(runtimeIdentity[0]?.can_delete, false);
  assert.equal(runtimeIdentity[0]?.can_execute, true);
  assert.equal(runtimeIdentity[0]?.can_select_cache, false);
  assert.equal(runtimeIdentity[0]?.can_insert_cache, false);
  assert.equal(runtimeIdentity[0]?.can_update_cache, false);
  assert.equal(runtimeIdentity[0]?.can_delete_cache, false);
  assert.equal(runtimeIdentity[0]?.can_get_cache, true);
  assert.equal(runtimeIdentity[0]?.can_put_cache, true);
  assert.equal(runtimeIdentity[0]?.jobs_are_restricted, true);
  assert.equal(runtimeIdentity[0]?.job_access_is_restricted, true);
  assert.equal(runtimeIdentity[0]?.can_create_job, true);
  assert.equal(runtimeIdentity[0]?.can_get_job, true);
  assert.equal(runtimeIdentity[0]?.can_claim_job, true);
  assert.equal(runtimeIdentity[0]?.can_complete_job, true);
  assert.equal(runtimeIdentity[0]?.can_record_job_failure, true);

  const runtimeRoleAttributes = await ownerSql`
    select
      roles.rolsuper,
      roles.rolcreatedb,
      roles.rolcreaterole,
      roles.rolreplication,
      roles.rolbypassrls,
      pg_has_role(
        ${runtimeRole},
        'shadscan_runtime',
        'MEMBER'
      ) as has_runtime_membership,
      case
        when exists (
          select 1 from pg_catalog.pg_roles where rolname = 'neon_superuser'
        ) then pg_has_role(${runtimeRole}, 'neon_superuser', 'MEMBER')
        else false
      end as has_neon_superuser_membership
    from pg_catalog.pg_roles as roles
    where roles.rolname = ${runtimeRole}
  `;
  assert.equal(runtimeRoleAttributes[0]?.rolsuper, false);
  assert.equal(runtimeRoleAttributes[0]?.rolcreatedb, false);
  assert.equal(runtimeRoleAttributes[0]?.rolcreaterole, false);
  assert.equal(runtimeRoleAttributes[0]?.rolreplication, false);
  assert.equal(runtimeRoleAttributes[0]?.rolbypassrls, false);
  assert.equal(runtimeRoleAttributes[0]?.has_runtime_membership, true);
  assert.equal(runtimeRoleAttributes[0]?.has_neon_superuser_membership, false);

  const concurrentResults = await Promise.all(
    Array.from({ length: 10 }, () => consume([primaryRule]))
  );
  const allowedCount = concurrentResults.filter(
    ([decision]) => decision?.allowed
  ).length;
  assert.equal(allowedCount, primaryRule.maxRequests);

  const storedWindows = await ownerSql`
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

  const companionWindows = await ownerSql`
    select count(*)::integer as count
    from rate_limit_windows
    where bucket = ${companionRule.bucket}
      and identity_hash = ${companionRule.identityHash}
  `;
  assert.equal(companionWindows[0]?.count, 0);

  const blockedWindow = await ownerSql`
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
  await ownerSql`
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
  const expiredRows = await ownerSql`
    select count(*)::integer as count
    from rate_limit_windows
    where bucket = ${expiredBucket}
  `;
  assert.equal(expiredRows[0]?.count, 0);

  const cachePayload = {
    report: "database verifier",
    verificationId,
  };
  await runtimeSql`
    select public.put_shadscan_scan_cache(
      ${cacheKey},
      ${cacheRepositoryHash},
      ${cacheCommitSha},
      ${"."},
      ${"all"},
      ${"verification-engine"},
      ${"verification-ruleset"},
      ${JSON.stringify(cachePayload)}::jsonb,
      ${60}
    )
  `;
  const cachedRows = await runtimeSql`
    select * from public.get_shadscan_scan_cache(${cacheKey})
  `;
  assert.deepEqual(cachedRows[0]?.payload, cachePayload);

  const createdJobs = await runtimeSql`
    select * from public.create_shadscan_scan_job(
      ${jobId}::uuid,
      ${jobTokenHash},
      ${jobCacheKey},
      ${cacheRepositoryHash},
      ${cacheCommitSha},
      ${"."},
      ${"all"},
      ${3600}
    )
  `;
  assert.equal(createdJobs[0]?.resolved_job_id, jobId);
  assert.equal(createdJobs[0]?.resolved_state, "queued");

  const unauthorizedJob = await runtimeSql`
    select * from public.get_shadscan_scan_job(
      ${jobId}::uuid,
      ${hashIdentity("wrong-token")}
    )
  `;
  assert.equal(unauthorizedJob.length, 0);

  const claimedJobs = await runtimeSql`
    select * from public.claim_shadscan_scan_job(
      ${jobId}::uuid,
      ${300},
      ${5},
      ${2}
    )
  `;
  assert.equal(claimedJobs[0]?.claim_action, "claimed");
  assert.equal(claimedJobs[0]?.attempt_count, 1);

  await runtimeSql`
    select public.put_shadscan_scan_cache(
      ${jobCacheKey},
      ${cacheRepositoryHash},
      ${cacheCommitSha},
      ${"."},
      ${"all"},
      ${"verification-engine"},
      ${"verification-ruleset"},
      ${JSON.stringify(cachePayload)}::jsonb,
      ${3600}
    )
  `;
  await runtimeSql`
    select public.complete_shadscan_scan_job(
      ${jobId}::uuid,
      ${jobCacheKey}
    )
  `;
  const completedJobs = await runtimeSql`
    select * from public.get_shadscan_scan_job(
      ${jobId}::uuid,
      ${jobTokenHash}
    )
  `;
  assert.equal(completedJobs[0]?.job_state, "completed");
  assert.deepEqual(completedJobs[0]?.payload, cachePayload);

  console.log(
    `Verified database rate limiting, scan caching, and queued job leases: ${allowedCount}/${concurrentResults.length} concurrent requests allowed.`
  );
} finally {
  await ownerSql`
    delete from rate_limit_windows
    where bucket like ${`${bucketPrefix}%`}
  `;
  await ownerSql`
    delete from scan_cache
    where cache_key in (${cacheKey}, ${jobCacheKey})
  `;
  await ownerSql`
    delete from scan_jobs
    where job_id = ${jobId}::uuid
  `;
}
