# Hosted scan API

shadscan exposes one synchronous, authenticated scan endpoint for AI agents and
other API clients:

- `POST /v1/scans`
- `GET /agent.md` for agent-safe operating instructions
- `GET /openapi.json` for the OpenAPI 3.1 contract

The service scans source only. It does not install dependencies, execute target
repository scripts, persist uploaded source, or modify the target project.
The unauthenticated `/scan` Server Action has separate public limits and is
documented in [web-scanner.md](web-scanner.md).

## Provision an API key

Generate a key and its server-side SHA-256 hash:

```bash
pnpm api:keygen production
```

The command prints the full key once and a JSON value for
`SHADSCAN_API_KEY_HASHES`. Store the full key in the user's or agent's secret
manager as `SHADSCAN_API_KEY`. Store only the JSON hash map on the API server.
Do not commit either value.

Each key has the form `shadscan_<key-id>_<secret>`. To rotate keys, generate a
new key ID, add its hash to the JSON map, move clients to the new key, and then
remove the old hash.

## Configure the server

Required in production:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Server-only Neon Postgres connection used for distributed limits. |
| `SHADSCAN_API_KEY_HASHES` | JSON object mapping key IDs to lowercase SHA-256 hashes of complete API keys. |

Optional:

| Variable | Purpose |
| --- | --- |
| `DATABASE_MIGRATION_URL` | Optional owner connection used by Drizzle migrations. `db:migrate` falls back to `DATABASE_URL`. |
| `GITHUB_TOKEN` | Server-side token for GitHub metadata and revision resolution. It is never forwarded to archive downloads. Public repositories only remain enforced. |
| `SHADSCAN_RATE_LIMIT_MODE=database` | Exercises the distributed limiter outside production. Development otherwise uses an in-memory limiter. |

Production fails closed when authentication or distributed rate limiting is not
configured. Limits are 10 requests per key per minute and 100 requests per key
per day.

Run `pnpm db:migrate` and `pnpm db:verify` against Neon before deploying a new
database migration. Migrations are an explicit release step and do not run from
`next build`.

For local development, configure `SHADSCAN_API_KEY_HASHES`, leave
`SHADSCAN_RATE_LIMIT_MODE` unset to use the in-memory limiter, and run:

```bash
pnpm dev
```

## Scan a public GitHub repository

The repository must be public. The server resolves the supplied branch, tag, or
commit to an immutable commit SHA before scanning.

```bash
printf 'Authorization: Bearer %s\n' "$SHADSCAN_API_KEY" | \
curl --fail-with-body --silent --show-error \
  --request POST \
  --url 'https://www.shadscan.com/v1/scans' \
  --header @- \
  --header 'Accept: application/json' \
  --header 'Content-Type: application/json' \
  --data '{
    "source": {
      "kind": "github",
      "repository": "OWNER/REPOSITORY",
      "revision": "HEAD",
      "subdirectory": "."
    }
  }'
```

An optional top-level `category` can select `foundation`, `interaction`,
`states`, `accessibility`, `forms`, or `production-polish`.

## Scan the current working tree

Use a sanitized `tar.gz` snapshot when the agent must scan local or uncommitted
changes. Follow `/agent.md` to construct and review the archive. The compressed
body is limited to 4 MiB and unsafe paths, secrets, generated directories,
links, devices, and other special entries are rejected.

```bash
printf 'Authorization: Bearer %s\n' "$SHADSCAN_API_KEY" | \
curl --fail-with-body --silent --show-error \
  --request POST \
  --url 'https://www.shadscan.com/v1/scans?subdirectory=.' \
  --header @- \
  --header 'Accept: text/markdown' \
  --header 'Content-Type: application/vnd.shadscan.snapshot+tar+gzip' \
  --data-binary '@PATH_TO_REVIEWED_SNAPSHOT.tar.gz'
```

`text/markdown` returns only the agent-ready prompt. `application/json` returns
the scan identity, versioned report, and the same prompt in
`handoff.promptMarkdown`. The report's `agentHandoff` keeps raw actionables for
rule-level consumers and adds grouped `workItems` plus version-pinned
verification commands. Errors are always versioned JSON.

## Operational boundaries

- Hosted work has a 25-second deadline within the 30-second route limit and
  returns a retryable `SCAN_TIMEOUT` error with status 504.
- GitHub source work has a 12-second timeout inside that end-to-end budget.
- GitHub archive downloads are capped at 16 MiB compressed.
- Extracted archives are capped at 32 MiB, 2,500 entries, and 2 MiB per file.
- Snapshot bytes are hashed and GitHub scans record the resolved commit SHA.
- Source materialization uses a temporary directory that is removed after every
  completed or failed scan.
- Rate-limit metadata is returned in `RateLimit-Limit`,
  `RateLimit-Remaining`, and `RateLimit-Reset`; 429 responses also include
  `Retry-After`.
- Keep `packages/cli` built before building or starting the Next.js service. The
  repository scripts do this automatically for development, type checking,
  tests, and production builds.

Run the focused API suite with:

```bash
pnpm test:api
```
