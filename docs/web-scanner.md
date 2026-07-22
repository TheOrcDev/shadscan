# Web Repository Scanner

The public `/scan` page accepts `owner/repository` or a canonical GitHub URL and
audits the default branch of a public repository. It uses a React Server Action;
the browser receives no shadscan API key, GitHub token, source archive, or
internal filesystem detail.

The scanner resolves the default branch to an immutable commit and inspects a
bounded GitHub tree before acquiring source. A root app is selected
automatically. One nested app is also selected automatically; ambiguous
monorepos show a project-path selector and do not consume full scan quota until
the user chooses an app.

## Production Environment

Configure these variables on every production deployment:

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Server-only Neon connection for a restricted runtime login that can execute only the bounded rate-limit, cache, and queued-job functions. |
| `SHADSCAN_WEB_RATE_LIMIT_SALT` | Secret random value of at least 32 characters. It HMACs client addresses before rate-limit storage and must not be exposed through `NEXT_PUBLIC_*`. |

Optional server-only variables:

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Raises GitHub metadata limits. Public repositories remain the only web-supported source, and authorization is not forwarded to `codeload.github.com`. |
| `SHADSCAN_WEB_MAX_COMPRESSED_MIB` | Compressed GitHub stream limit in MiB. Default `32`; hard ceiling `64`. |
| `SHADSCAN_WEB_MAX_EXPANDED_MIB` | Expanded GitHub stream limit in MiB. Default `128`; hard ceiling `256`. |
| `SHADSCAN_WEB_MAX_ARCHIVE_ENTRIES` | Raw tar entry limit. Default `10000`; hard ceiling `50000`. |
| `SHADSCAN_WEB_MAX_RETAINED_FILE_MIB` | Per-file limit for source the scanner reads. Default `8`; hard ceiling `16`. |
| `SHADSCAN_WEB_SOURCE_MODE` | Source acquisition mode: `archive`, `sparse`, or `auto`. Default `archive`. |
| `SHADSCAN_WEB_CACHE_ENABLED` | Set to `true` to reuse successful reports for the same immutable commit, selected project path, and scanner identity. Default `false`. |
| `SHADSCAN_WEB_CACHE_TTL_HOURS` | Successful-report cache lifetime. Default `168`; hard ceiling `720`. |
| `SHADSCAN_WEB_ASYNC_ENABLED` | Set to `true` to queue hard-bounded projects above the synchronous soft thresholds. Default `false`. |
| `SHADSCAN_WEB_SYNC_RELEVANT_FILES` | Relevant-file soft threshold before async dispatch. Default `1500`; hard ceiling `10000`. |
| `SHADSCAN_WEB_SYNC_RELEVANT_MIB` | Relevant-source soft threshold before async dispatch. Default `16`; hard ceiling `50`. |
| `SHADSCAN_WEB_ASYNC_JOB_TTL_HOURS` | Queue message, job, and polling-access lifetime. Default `24`; hard ceiling `168`. |
| `SHADSCAN_WEB_ASYNC_MAX_ATTEMPTS` | Worker claim limit for retryable failures. Default `5`; hard ceiling `10`. |
| `SHADSCAN_WEB_ASYNC_MAX_CONCURRENCY` | Global active job-lease limit enforced in Neon. Default `2`; hard ceiling `10`. |
| `SHADSCAN_PUBLIC_GITHUB_REPOSITORY` | Enables the public source link and star count after an unauthenticated GitHub lookup confirms the configured `owner/repository` is public. Leave unset while the source repository is private. |
| `SHADSCAN_WEB_RATE_LIMIT_MODE=database` | Exercises the production web limiter outside `NODE_ENV=production`. |
| `SHADSCAN_RATE_LIMIT_MODE=database` | Exercises the authenticated `/v1/scans` limiter outside production. |
| `SHADSCAN_API_KEY_HASHES` | Required for `/v1/scans`, but not used by the public Server Action. |

Generate a deployment salt with a secret manager or a cryptographically secure
command such as `openssl rand -base64 48`. Rotate it deliberately: changing the
salt changes every client rate-limit identity.

Production fails closed when the salt or database connection is missing or when
Postgres is unavailable. Development uses an in-memory limiter and a fixed
development salt unless database mode is explicitly enabled. Its sliding-window
calculations and atomic multi-rule consumption match the database limiter, while
state remains process-local and ephemeral. The public limits are 10 scans per
client per 10 minutes, 20 per client per day, and 10 per repository per day.
Invalid source limits, non-integer values, and values above the compiled hard
ceilings also fail closed. Limits are read per request, so build and test imports
do not require production environment variables.

The Drizzle migrations create a bounded sliding-window counter table, its
atomic consumption function, and a no-login permission role. Keep the owner
credential in the release secret store as `DATABASE_MIGRATION_URL`; do not
deploy it to Vercel. Apply migrations, provision the runtime login, and verify
least privilege before deploying code that uses the database:

```bash
pnpm db:check
pnpm db:migrate
pnpm db:provision-runtime
pnpm db:verify
```

See [database-roles.md](database-roles.md) for the credential and rotation
workflow.

Runtime identities are SHA-256 or HMAC-SHA-256 digests. Raw client addresses,
repository names, API keys, source archives, and scan reports are not stored in
the rate-limit table. When report caching is enabled, Neon stores a validated
successful report keyed by a repository digest, immutable commit, selected
project path, and scanner contract versions. Source files and archives are
never cached. Expired windows and cache rows are removed in bounded batches
during normal traffic.

Async dispatch uses Vercel Queues topic `shadscan-scans`, configured by the
private `queue/v2beta` trigger in `vercel.json`. Vercel supplies queue OIDC
credentials automatically in deployments. A queued message contains only a
schema version, opaque job ID, cache key, public `owner/repository`, immutable
commit SHA, selected project path, and optional category. It never contains
source files or an archive. The browser polls with a 256-bit bearer token;
Neon stores only its SHA-256 hash.

## Runtime Boundaries

- Each process admits at most two active scans. Additional submissions are not
  queued and return retryable `SCAN_BUSY` with a five-second retry interval;
  rejected submissions do not consume scan quota.
- When async dispatch is enabled, relevant manifests over either soft threshold
  bypass synchronous admission and enter the durable queue only after the full
  scan rate limit succeeds. The CLI hard limits remain 10,000 relevant files
  and 50 MiB; work beyond either limit is never queued.
- Queue consumers claim jobs through an atomic Neon lease. Active unexpired
  leases are globally capped, duplicate delivery checks the result cache before
  source work, and retryable failures are attempted at most the configured
  count. The provider uses at-least-once delivery, so every transition is
  idempotent.
- The private queue route has a 300-second function duration, a 240-second
  application deadline, and a five-minute visibility lease that the SDK
  extends while work is active. The public polling route is non-cacheable and
  accepts the bearer token only through the `Authorization` header.
- Source parsing and rule evaluation run in a disposable, resource-limited
  worker with no deployment secrets in its environment. Request aborts
  terminate the worker before temporary source cleanup; worker crashes become
  retryable `SCAN_WORKER_FAILED` errors with a local CLI fallback.
- The worker is a failure and resource boundary, not a security sandbox. The
  scanner does not execute repository code.
- `/scan` runs in the Node.js runtime with a 30-second execution limit.
- The full server action has a 25-second deadline so it can return a stable
  `SCAN_TIMEOUT` error before the platform terminates it.
- GitHub source work has a 12-second timeout inside that end-to-end budget.
- GitHub archives stream through bounded compressed and expanded byte counters;
  the public defaults are 32 MiB compressed and 128 MiB expanded.
- Extraction permits at most 10,000 raw archive entries and 8 MiB for one
  retained source file. Irrelevant assets are streamed and counted but are not
  retained; path-sensitive assets such as favicons become zero-byte markers.
- Limit errors identify the failed counter, configured threshold, measured
  value at cancellation, and a normalized path when one retained file failed.
- `SHADSCAN_WEB_SOURCE_MODE=auto` uses bounded GitHub blob requests for selected
  manifests of at most 64 content files and 8 MiB, then falls back to streamed
  archive acquisition. Sparse identity hashes the immutable, path-sorted blob
  manifest; archive identity hashes the compressed archive bytes.
- Recursive GitHub trees are capped by the configured raw-entry limit. A
  truncated tree is completed through at most 100 non-recursive subtree
  requests; incomplete trees are never scanned silently.
- Temporary source is removed after success and failure.
- Source is always temporary. Successful reports are persisted only when
  `SHADSCAN_WEB_CACHE_ENABLED=true`, for at most the configured cache lifetime;
  failed and partial scans are never cached. Async jobs necessarily persist a
  successful report in the same cache so polling can return it, even when
  general synchronous cache reuse is disabled.

`next.config.ts` excludes repository source and development files from the
scanner route traces while retaining `packages/cli/dist/index.js` and its
license. Every production build runs `pnpm verify:trace` through `postbuild` and
fails if the scanner runtime is missing, unrelated project source is traced, or
either traced entry cannot load from an isolated deployment sandbox.

## Local Verification

Install Chromium once, then run the focused web gates:

```bash
pnpm exec playwright install chromium
pnpm test:web
pnpm test:e2e
pnpm build
pnpm audit:self
```

The browser suite uses Next.js test-proxy interception to serve deterministic
GitHub metadata and archive fixtures. It does not contact GitHub. Coverage
includes empty, pending, complete, validation, retryable, and terminal states;
focus and keyboard behavior; clipboard actions; reduced motion; light and dark
themes; target widths from 320 to 1440 CSS pixels; and serious or critical axe
violations.

For a production deployment, also confirm that the platform honors the
30-second function duration, injects the required variables only on the server,
and does not cache Server Action responses or source archives at the platform
edge.

## Staged Rollout And Rollback

1. Deploy migrations and exact source-limit reporting with
   `SHADSCAN_WEB_SOURCE_MODE=archive`, cache disabled, and async disabled.
2. Set `SHADSCAN_WEB_SOURCE_MODE=auto` and compare archive/sparse report parity
   for the same immutable commit and project path.
3. Enable cache reads and writes with `SHADSCAN_WEB_CACHE_ENABLED=true`. Disable
   the flag to roll back immediately; retained rows do not block synchronous
   scans and expire without manual deletion.
4. Enable async only after observed synchronous latency justifies it. Start
   with the default soft thresholds and concurrency of two. Disabling
   `SHADSCAN_WEB_ASYNC_ENABLED` stops new dispatches immediately; the private
   consumer intentionally continues draining already accepted messages.
5. Lower concurrency or raise the soft thresholds to reduce queue traffic.
   Changing either setting requires no data migration. Never raise source
   settings beyond their compiled hard ceilings.

Before enabling each stage, run `pnpm db:verify`, deploy a preview, and test a
root app, selected monorepo app, cache hit, exact hard-limit failure, and queued
scan. Rollback never requires deleting cache or job rows.
