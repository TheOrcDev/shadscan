# Web Repository Scanner

The public `/scan` page accepts `owner/repository` or a canonical GitHub URL and
audits the default branch of a public repository. It uses a React Server Action;
the browser receives no shadscan API key, GitHub token, source archive, or
internal filesystem detail.

## Production Environment

Configure these variables on every production deployment:

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Server-only Neon connection for a restricted runtime login that can execute only the rate-limit function. |
| `SHADSCAN_WEB_RATE_LIMIT_SALT` | Secret random value of at least 32 characters. It HMACs client addresses before rate-limit storage and must not be exposed through `NEXT_PUBLIC_*`. |

Optional server-only variables:

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Raises GitHub metadata limits. Public repositories remain the only web-supported source, and authorization is not forwarded to `codeload.github.com`. |
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
the rate-limit table. Expired windows are removed in bounded batches during
normal traffic.

## Runtime Boundaries

- `/scan` runs in the Node.js runtime with a 30-second execution limit.
- The full server action has a 25-second deadline so it can return a stable
  `SCAN_TIMEOUT` error before the platform terminates it.
- GitHub source work has a 12-second timeout inside that end-to-end budget.
- GitHub archives are limited to 16 MiB compressed and 32 MiB extracted.
- Extraction permits at most 2,500 entries and 2 MiB per file.
- Temporary source is removed after success and failure.
- The browser result is session-only; no source or report is persisted.

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
and does not cache Server Action results or source archives.
