# Web Repository Scanner

The public `/scan` page accepts `owner/repository` or a canonical GitHub URL and
audits the default branch of a public repository. It uses a React Server Action;
the browser receives no Shadscan API key, GitHub token, source archive, or
internal filesystem detail.

## Production Environment

Configure these variables on every production deployment:

| Variable | Requirement |
| --- | --- |
| `SHADSCAN_WEB_RATE_LIMIT_SALT` | Secret random value of at least 32 characters. It HMACs client addresses before rate-limit storage and must not be exposed through `NEXT_PUBLIC_*`. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint for distributed web and hosted-API limits. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token paired with the endpoint. |

Optional server-only variables:

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Raises GitHub metadata limits. Public repositories remain the only web-supported source, and authorization is not forwarded to `codeload.github.com`. |
| `SHADSCAN_WEB_RATE_LIMIT_MODE=redis` | Exercises the production web limiter outside `NODE_ENV=production`. |
| `SHADSCAN_RATE_LIMIT_MODE=redis` | Exercises the authenticated `/v1/scans` limiter outside production. |
| `SHADSCAN_API_KEY_HASHES` | Required for `/v1/scans`, but not used by the public Server Action. |

Generate a deployment salt with a secret manager or a cryptographically secure
command such as `openssl rand -base64 48`. Rotate it deliberately: changing the
salt changes every client rate-limit identity.

Production fails closed when the salt, Redis URL, or Redis token is missing or
when Redis is unavailable. Development uses an in-memory limiter and a fixed
development salt unless Redis mode is explicitly enabled. The public limits are
three scans per client per 10 minutes, 20 per client per day, and 10 per
repository per day.

## Runtime Boundaries

- `/scan` runs in the Node.js runtime with a 30-second execution limit.
- GitHub source work has a 12-second timeout inside that route budget.
- GitHub archives are limited to 16 MiB compressed and 32 MiB extracted.
- Extraction permits at most 2,500 entries and 2 MiB per file.
- Temporary source is removed after success and failure.
- The browser result is session-only; no source or report is persisted.

`next.config.ts` excludes repository source and development files from the
scanner route traces while retaining `packages/cli/dist/index.js` and its
license. Every production build runs `pnpm verify:trace` through `postbuild` and
fails if the scanner runtime is missing or unrelated project source is traced.

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
