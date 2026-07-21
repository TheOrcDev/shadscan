# Plan 001: Scale public web repository scans without removing safety limits

> **Executor instructions**: Follow this plan in order. Each numbered slice is
> an independently deployable commit. Run its focused tests before continuing.
> Do not combine slices into one large change. If a STOP condition occurs,
> report it instead of improvising. When all slices are complete, update the
> status row in `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 4c22d65..HEAD -- app/scan lib/shadscan-api lib/shadscan-web lib/db test/shadscan-api test/shadscan-web test/e2e docs app/privacy app/terms drizzle package.json next.config.ts scripts/verify-production-trace.mjs`
> Compare every changed in-scope module with the current-state notes below.
> Stop if a newer implementation already changes the acquisition, cache, or
> asynchronous boundaries described here.

## Status

- **Priority**: P1
- **Effort**: XL, delivered as seven slices
- **Risk**: HIGH
- **Depends on**: none
- **Category**: correctness, performance, architecture, security, UX
- **Planned at**: commit `4c22d65`, 2026-07-22

## Outcome

The public scanner will:

1. Skip large files that cannot affect a Shadscan result while preserving
   path-presence signals needed by rules such as favicon and social-preview
   checks.
2. Return the exact budget that was exceeded, including its configured limit
   and the observed value at rejection time.
3. Read validated, environment-configurable source budgets with conservative
   compiled hard ceilings.
4. Let users select a React project inside a monorepo and acquire only the
   selected project plus required ancestor metadata.
5. Reuse successful reports by immutable commit SHA, project path, category,
   and scanner contract versions.
6. Send only genuinely large but still scannable projects to a durable
   asynchronous worker. Inputs beyond the CLI's own scan budget remain a clear
   local-only failure instead of being queued forever.

## Why This Matters

The current web transport rejects repositories before the scanner evaluates
them. It caps the complete GitHub tarball at 16 MiB compressed, 32 MiB
expanded, 2,500 entries, and 2 MiB per entry. A single tracked screenshot or a
large documentation tree can therefore reject a small React application.

The CLI itself can inspect 10,000 source files and 50 MiB of relevant source.
The web transport is enforcing a repository budget while the scanner needs an
application-source budget. This plan aligns those boundaries without removing
tar-bomb, path-traversal, memory, timeout, or abuse protections.

## Current State

- `lib/shadscan-api/archive.ts:15-20` defines one global archive profile:
  16 MiB compressed, 32 MiB expanded, 2,500 entries, 2 MiB per file.
- `lib/shadscan-api/archive.ts:362-366` buffers the entire expanded tar archive
  with `gunzip`, so increasing the limit directly increases peak memory.
- `lib/shadscan-api/github-source.ts:306-344` downloads the complete GitHub
  archive before extraction.
- `lib/shadscan-web/errors.ts:12-18` maps five distinct source-budget errors to
  one `SOURCE_TOO_LARGE` result; `:125-128` discards the failed budget.
- `lib/shadscan-web/run-repository-scan.ts:57-63` always requests
  `subdirectory: "."`.
- `lib/shadscan-web/normalize-repository.ts` rejects GitHub URLs with path
  segments beyond `owner/repository`.
- `packages/cli/src/rules/source-files.ts:60-62` supports 10,000 source files,
  2 MiB per source file, and 50 MiB total source; oversized source files are
  skipped with partial-coverage warnings instead of failing the audit.
- `lib/db/schema.ts` and the Drizzle migrations currently store only bounded
  rate-limit windows. The runtime database role is intentionally least
  privileged and calls security-definer functions rather than receiving broad
  table access.
- `docs/web-scanner.md` promises that source and reports are session-only and
  not persisted. Any cache changes this contract and requires a privacy/docs
  update in the same slice.
- `app/scan/page.tsx` limits the synchronous request to 30 seconds, while
  `lib/shadscan-api/deadline.ts` uses a 25-second application deadline.

## Target Request Flow

```text
normalize input and project path
  -> enforce request rate limits
  -> verify repository is still public
  -> resolve HEAD to immutable commit SHA
  -> discover/validate selected project
  -> build cache identity
  -> return validated cache hit, if present
  -> classify retained source against sync/async/hard budgets
     -> synchronous: acquire -> scan worker -> cache -> return
     -> asynchronous: create job -> queue -> poll -> cache -> return
     -> hard limit: exact terminal error plus local CLI fallback
```

Cache hits must bypass scan admission and source acquisition, but they must not
bypass repository-publicness verification or abuse controls.

## Source Budget Model

Replace the single overloaded archive profile with named counters:

| Budget | Proposed default | Compiled hard ceiling | Behavior |
|--------|------------------|-----------------------|----------|
| Compressed GitHub bytes | 32 MiB | 64 MiB | terminal exact error |
| Streamed expanded bytes | 128 MiB | 256 MiB | terminal exact error |
| Raw archive entries | 10,000 | 50,000 | terminal exact error |
| One retained entry | 8 MiB | 16 MiB | skip presence-only/irrelevant; fail relevant content above limit |
| Relevant source files | 10,000 | 10,000 | align with CLI; local-only above limit |
| Relevant source bytes | 50 MiB | 50 MiB | align with CLI; local-only above limit |

Treat these as initial values, not guesses carved into the public contract.
The executor must benchmark the large-repository fixtures in Slice 0 and lower
defaults if the synchronous route approaches its memory or deadline budget.

Environment variables should use human-readable MiB/entry units:

```text
SHADSCAN_WEB_MAX_COMPRESSED_MIB
SHADSCAN_WEB_MAX_EXPANDED_MIB
SHADSCAN_WEB_MAX_ARCHIVE_ENTRIES
SHADSCAN_WEB_MAX_RETAINED_FILE_MIB
SHADSCAN_WEB_SOURCE_MODE=archive|sparse|auto
SHADSCAN_WEB_CACHE_ENABLED=true|false
SHADSCAN_WEB_ASYNC_ENABLED=true|false
```

Invalid, non-integer, negative, or above-ceiling values must fail configuration
validation. Never silently clamp a production misconfiguration.

## Required Error Contract

Add a bounded internal detail object:

```ts
interface SourceLimitDetail {
  kind:
    | "compressed_bytes"
    | "expanded_bytes"
    | "archive_entries"
    | "retained_file_bytes"
    | "relevant_files"
    | "relevant_source_bytes";
  limit: number;
  observed: number;
  path?: string;
  unit: "bytes" | "entries";
}
```

`observed` means the measured counter when the operation stopped. Do not claim
it is the final repository total when streaming stops at the limit. `path` may
contain only a normalized repository-relative public path, bounded to 512
characters. Never expose temporary filesystem paths, upstream URLs, tokens, or
raw causes.

The public web error keeps `code: "SOURCE_TOO_LARGE"` for compatibility and
adds optional validated `sourceLimit`. The authenticated `/v1/scans` error body
must remain unchanged in Slice 1 unless its schema version is deliberately
bumped with matching OpenAPI and contract tests.

## Authoritative Retention Policy

Classify GitHub entries into three modes before collecting their bytes:

- `content`: files the scanner reads, including package/config manifests,
  JavaScript/TypeScript/JSX/TSX, CSS, HTML, and relevant text SEO files.
- `presence`: binary or generated metadata files whose path affects a rule but
  whose contents do not, such as favicon and static social-preview assets.
  Materialize a zero-byte marker while the source digest records the original
  blob identity and size.
- `ignore`: images, videos, fonts, archives, docs, fixtures, and unrelated
  workspace paths that cannot affect the selected app's report. Drain without
  materializing.

Do not maintain an undocumented second list of scanner inputs. Introduce an
immutable source-requirements export from `@shadscan/cli`, derived from the
existing discovery and rule globs, and make both local discovery tests and the
hosted retention policy consume or validate it. A new rule that reads another
path must update this contract and a parity test.

Forbidden paths, links, duplicate paths, path conflicts, traversal, depth, and
length checks remain enforced before retention decisions. Snapshot uploads keep
their existing reject-oriented policy; relaxed skipping applies only to public
GitHub acquisition.

## Commands

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| API tests | `pnpm ci:test-api` | all `test/shadscan-api` tests pass |
| Web tests | `pnpm ci:test-web` | all `test/shadscan-web` tests pass |
| Browser tests | `pnpm ci:test-e2e` | all Playwright tests pass |
| Database contract | `pnpm db:check` | Drizzle schema and migrations are valid |
| Typecheck | `pnpm typecheck` | exit 0, no TypeScript errors |
| Lint | `pnpm check` | Ultracite reports no issues |
| Production build | `pnpm build` | Next build and trace verification pass |
| Dogfood audit | `pnpm audit:self` | score meets the repository floor |

## Scope

Likely in-scope paths are listed per slice. Keep changes within them unless a
compile error proves a direct contract caller must move too.

Out of scope for the entire plan:

- Changing rule scores, rule confidence, or the bundled ruleset solely to make
  hosted scans easier.
- Supporting private GitHub repositories.
- Executing repository code or package scripts.
- Persisting repository archives, file contents, or failed scan reports.
- Removing hard source limits.
- Serving a cached public report without rechecking that GitHub still reports
  the repository as public.
- Treating `waitUntil()` as a durable job queue; it remains bound to function
  duration and is not suitable for required scan completion.

## Git Workflow

- Create branch `codex/web-scan-scale` unless the operator explicitly requests
  direct work on `main`.
- Use one conventional commit per slice, matching recent history. Suggested
  subjects appear below.
- Do not publish npm, run database migrations against production, enable queue
  infrastructure, push, or open a PR without explicit operator instruction.

## Slice 0: Establish Characterization Fixtures And Measurements

**Commit**: `test(web): characterize large repository acquisition`

Create deterministic tar/tree fixtures covering:

1. A small React app plus a 3 MiB irrelevant PNG.
2. A small React app plus more than 2,500 irrelevant docs/assets entries.
3. A monorepo with `apps/web`, `apps/admin`, and unrelated packages.
4. A selected app containing favicon and social-preview binary files whose
   presence must still pass rules after content is omitted.
5. A genuinely oversized selected app above 10,000 relevant files or 50 MiB of
   relevant source.

Add phase timers and non-sensitive counters to the injected test logger:
compressed bytes, expanded bytes, raw entries, retained entries/bytes,
acquisition mode, selected path, cache hit, and sync/async classification. Do
not log repository source, file paths, client addresses, or tokens.

Use `test/shadscan-api/test-archive.ts` for archive generation and
`test/shadscan-web/run-repository-scan.test.ts` for dependency-injected request
flow tests. Capture the current expected failures before changing behavior.

**Verify**: `pnpm ci:test-api && pnpm ci:test-web` -> all existing tests pass and
the new characterization tests demonstrate the current limit failures.

## Slice 1: Skip Irrelevant Files And Expose Exact Limits

**Commit**: `fix(web): skip irrelevant source and report exact limits`

In-scope paths:

- `packages/cli/src/discovery.ts`
- `packages/cli/src/rules/source-files.ts`
- `packages/cli/src/index.ts`
- `lib/shadscan-api/archive.ts`
- `lib/shadscan-api/errors.ts`
- `lib/shadscan-web/errors.ts`
- `lib/shadscan-web/contracts.ts`
- `lib/shadscan-web/types.ts`
- `app/scan/repository-scanner.tsx`
- focused API/web/component tests

Steps:

1. Add the authoritative source-requirements export and tests proving every
   current discovery/rule path is represented as `content` or `presence`.
2. Add an optional GitHub-only archive-entry policy. Preserve default snapshot
   behavior exactly.
3. Apply security/path validation before policy selection. Drain ignored files
   without allocation. Materialize zero-byte presence markers.
4. Attach `SourceLimitDetail` at every budget rejection site.
5. Map the detail into the web-only error schema. Render tailored copy such as
   `Archive entries reached 10,001; hosted limit is 10,000.` Keep the local CLI
   fallback visible.
6. Add a structured log field containing only the limit kind, never the path.

Tests must prove that a large PNG and irrelevant entry tree no longer fail, the
favicon/social-preview rules keep the same result, a large relevant source file
still follows the CLI's partial-coverage behavior, and every true overflow
returns the correct kind/limit/observed/unit.

**Verify**: `pnpm ci:test-api && pnpm ci:test-web && pnpm typecheck` -> all pass.

## Slice 2: Stream GitHub Archives And Configure Moderate Limits

**Commit**: `perf(web): stream GitHub archives with bounded profiles`

In-scope paths:

- `lib/shadscan-api/archive.ts`
- `lib/shadscan-api/github-source.ts`
- new `lib/shadscan-web/source-config.ts`
- `lib/shadscan-web/run-repository-scan.ts`
- `docs/web-scanner.md`
- `docs/hosted-api.md`
- focused API/web tests

Steps:

1. Keep buffered `extractTarGzip` for bounded uploaded snapshots. Add a GitHub
   streaming path that pipes `Response.body` through compressed-byte counting,
   `createGunzip`, expanded-byte counting, and `tar-stream` extraction.
2. Ensure abort signals destroy the network reader, gunzip stream, tar parser,
   and pending writes. Cleanup must still run after every failure.
3. Parse the environment profile through a pure, dependency-injected function.
   Defaults use the proposed moderate values and compiled ceilings above.
4. Pass the web profile explicitly from the public scanner. Do not accidentally
   alter authenticated snapshot limits or make module import depend on a valid
   production environment during tests/builds.
5. Add exact byte-boundary, chunk-boundary, abort, malformed gzip, compression
   bomb, and cleanup tests.
6. Update docs with defaults, hard ceilings, environment names, and the fact
   that ignored entries are streamed but not retained.

Record peak RSS and elapsed time for every Slice 0 fixture in the plan/PR notes.
The sync route must remain below 70% of its configured memory and 20 seconds at
the p95 fixture run. If it does not, lower defaults or move that class to async.

**Verify**: `pnpm ci:test-api && pnpm ci:test-web && pnpm build` -> all pass,
including production trace verification.

## Slice 3: Add Project Selection And Sparse GitHub Acquisition

**Commit**: `feat(web): scan selected GitHub project paths`

In-scope paths:

- `lib/shadscan-web/normalize-repository.ts`
- `lib/shadscan-web/contracts.ts`
- `lib/shadscan-web/types.ts`
- `lib/shadscan-web/run-repository-scan.ts`
- `lib/shadscan-api/github-source.ts`
- new GitHub tree/source-manifest modules under `lib/shadscan-api/`
- `app/scan/actions.ts`
- `app/scan/repository-scanner.tsx`
- `app/scan/scan-result.tsx`
- focused unit, component, and E2E tests

Steps:

1. Extend normalized input with optional `projectPath`, validated through the
   existing `PortableSubdirectorySchema`. Keep repository and project path as
   separate form values so branch names containing `/` are never ambiguously
   parsed from a GitHub `/tree/` URL.
2. Add a GitHub tree discovery call after publicness and immutable-SHA
   resolution. Identify candidate React package roots from `package.json`,
   `components.json`, App/Pages Router directories, and Vite entry paths.
3. If root is a valid React project, select `.`. If exactly one nested project
   exists, select it. If multiple exist, return a new
   `project_selection_required` state containing bounded label/path options and
   render an accessible shadcn selection control. Do not consume full scan
   quota twice; use a separately bounded discovery admission/rate-limit path or
   a signed short-lived discovery token.
4. For a selected path, build a canonical source manifest from immutable tree
   entries. Include the selected subtree and only ancestor package-manager/
   workspace metadata required by `discoverProject`. Reject symlinks,
   submodules, unsafe modes, truncated unbounded trees, and path escapes.
5. Acquire bounded manifests sparsely through GitHub tree/blob endpoints with
   strict API-origin validation, byte counters, abort support, and low
   concurrency. For manifests where per-blob requests would exceed the sync
   request budget, use the streaming tar path filtered to the selected project
   or classify the request as async; never issue thousands of synchronous API
   requests blindly.
6. Compute `sourceDigest` from a canonical, path-sorted manifest of relative
   path, immutable blob SHA, original size, and retention mode. The same commit
   and path must produce the same digest regardless of response order.
7. Show the selected project path in results and include it in the local CLI
   fallback guidance.

GitHub recursive trees can be truncated. When `truncated: true`, traverse
non-recursive subtrees under the selected path with explicit request and entry
budgets. Do not silently scan an incomplete tree.

Tests must cover root apps, one nested app, multiple candidates, invalid paths,
missing paths, branch-independent commit pinning, tree truncation, unsafe tree
modes, deterministic digest ordering, GitHub rate limiting, and selection UI at
320px and desktop widths.

**Verify**: `pnpm ci:test-api && pnpm ci:test-web && pnpm ci:test-e2e && pnpm build`
-> all pass.

## Slice 4: Cache Successful Immutable Scan Results In Neon

**Commit**: `feat(web): cache successful scans by commit identity`

In-scope paths:

- `lib/db/schema.ts`
- `lib/db/client.ts`
- new cache module under `lib/shadscan-web/`
- new Drizzle migrations and runtime-role verification updates
- `lib/shadscan-web/run-repository-scan.ts`
- `lib/shadscan-web/log.ts`
- `docs/web-scanner.md`
- `docs/database-roles.md`
- `app/privacy/page.tsx`
- `app/terms/page.tsx` only if legal copy requires matching retention language
- database/web tests

Use this cache identity:

```text
sha256(
  repository-key-hash + NUL +
  commit-sha + NUL +
  project-path + NUL +
  category-or-all + NUL +
  engine-version + NUL +
  ruleset-version + NUL +
  report-schema-version + NUL +
  prompt-version + NUL +
  hosted-schema-version
)
```

Steps:

1. Add a `scan_cache` table with cache key, repository hash, immutable commit,
   project path, contract versions, validated result payload, source digest,
   creation time, and expiry time. Start with a configurable seven-day TTL and
   a bounded payload size.
2. Preserve least privilege. The production runtime role receives execution
   on narrow security-definer `get`/`put` functions, not direct table rights.
   Lock `search_path`, validate all arguments, and perform bounded expired-row
   cleanup on writes.
3. Resolve publicness and commit SHA before lookup. A repository that has become
   private must never receive an old cached report.
4. Validate every JSONB hit with the current Zod schemas. Treat malformed or
   expired rows as misses and delete them best-effort.
5. Cache only completed successful results. Store no archives or file contents
   outside the report. Generate a fresh scan ID for each response rather than
   reusing the ID stored by the original operation.
6. Cache failure is an optimization failure: log `cache_read_failed` or
   `cache_write_failed` and continue the scan. It must not turn a valid scan
   into `SERVICE_NOT_CONFIGURED`.
7. Look up cache before scan admission. Record hit/miss and age without putting
   raw repository names into the cache table.
8. Update privacy, terms if needed, and scanner docs before deployment. State
   exactly what report data is retained, for how long, why, and that temporary
   source remains deleted.

Tests must cover hit, miss, expiry, version invalidation, category/path
separation, repository-publicness recheck, malformed JSONB, fresh IDs,
best-effort database failure, least-privilege SQL, and bounded cleanup.

**Verify**: `pnpm db:check && pnpm ci:test-web && pnpm typecheck && pnpm build`
-> all pass. Apply production migrations only after a reviewed backup and
least-privilege verification; migration execution is outside this plan's
automatic steps.

## Slice 5: Queue Only Genuinely Large But Scannable Projects

**Commit**: `feat(web): dispatch oversized scans asynchronously`

Do not start this slice until production metrics show that selective
acquisition still has a meaningful class of safe scans that exceed the sync
deadline. If no such class exists, keep async disabled and mark this slice
REJECTED as unnecessary complexity.

Initial classification, refined from production measurements:

- `sync`: relevant manifest is comfortably below the CLI budget and predicted
  acquisition plus scan p95 is under 20 seconds.
- `async`: relevant manifest is at or below 10,000 files and 50 MiB but exceeds
  the sync soft threshold.
- `local_only`: relevant manifest exceeds the CLI's own hard source budget or
  violates a security/source contract. Do not queue it.

Recommended provider boundary:

```ts
interface ScanDispatcher {
  dispatch(input: ImmutableGitHubScanInput): Promise<
    | { kind: "completed"; result: HostedScanResponse }
    | { jobToken: string; kind: "queued" }
  >;
}
```

Implement the synchronous dispatcher first and put the Vercel adapter behind
`SHADSCAN_WEB_ASYNC_ENABLED`. Vercel Queues is currently beta and uses
at-least-once delivery, so the adapter must be replaceable and the consumer
idempotent. Do not use `waitUntil()` for required work because it remains bound
to the function timeout.

Steps:

1. Add a `scan_jobs` table with opaque job ID, hashed bearer token, cache key,
   state, timestamps, expiry, attempts, terminal public error, and result-cache
   reference. Do not persist source archives. Queue messages may contain only
   immutable public GitHub coordinates and bounded scan options.
2. Publish with the cache identity as the idempotency key. At-least-once
   consumers must claim/update jobs atomically, check the result cache first,
   and make repeated delivery converge on one completed result.
3. Configure a private queue consumer route with explicit concurrency and
   retry policy. Retry upstream/timeouts; acknowledge terminal validation and
   hard-limit failures. Cap delivery attempts and record a stable terminal
   error before acknowledgment.
4. Extend web state with `queued`, `running`, `complete`, and `failed`. Return
   quickly from submission and poll with an opaque bearer token using bounded
   backoff. Announce status through the existing live region and preserve focus
   behavior.
5. Set job and result retention explicitly. Expire abandoned jobs and ensure a
   completed job resolves through the same validated cache payload used by
   synchronous hits.
6. Update production trace verification for the consumer entry point and add
   queue configuration documentation. Deploy with the feature flag off, verify
   infrastructure, then enable for a canary threshold.

Tests must simulate duplicate delivery, worker crash and retry, lease expiry,
cache-before-work, terminal source error, token rejection, job expiry, disabled
provider, and accessible polling UI. No test should contact Vercel or GitHub.

**Verify**: `pnpm ci:test-api && pnpm ci:test-web && pnpm ci:test-e2e && pnpm build`
-> all pass with async both enabled and disabled in deterministic tests.

## Slice 6: Roll Out In Stages And Remove Dead Paths

**Commit**: `docs(web): document scalable scan rollout`

1. Deploy exact errors and metrics first; observe which budgets actually fire.
2. Enable moderate streaming limits with `SOURCE_MODE=archive`.
3. Enable project selection and `SOURCE_MODE=auto`; compare report parity for
   the same commit/path between archive and sparse modes.
4. Enable cache reads, then writes. Monitor hit rate, validation failures,
   database latency, and cache size.
5. Enable async only for a narrow measured threshold. Monitor queue age,
   retries, duplicate deliveries, completion time, and cost.
6. After two stable release windows, remove obsolete buffered GitHub paths and
   stale feature flags. Keep the snapshot extractor and local CLI behavior.

Document rollback for every flag. A rollback must never require deleting cache
or job data before the old synchronous path can serve traffic.

**Verify**: run the full command table above and manually test one root app, one
selected monorepo app, one cache hit, one exact hard-limit failure, and one
queued scan in the production preview environment.

## Test Plan Summary

- Model archive tests on `test/shadscan-api/archive.test.ts`.
- Model request orchestration and dependency injection on
  `test/shadscan-web/run-repository-scan.test.ts`.
- Model database failure/least-privilege tests on
  `test/shadscan-web/database-rate-limit.test.ts` and
  `test/shadscan-api/database-role-contract.test.ts`.
- Extend `test/e2e/scan-page.spec.ts` for selection, exact errors, cache-neutral
  result rendering, queue polling, mobile layout, keyboard use, reduced motion,
  and axe checks.
- Keep all GitHub and queue traffic mocked. Production tests must not depend on
  external service availability.

## Done Criteria

- [ ] A repository containing a 3 MiB irrelevant image scans successfully.
- [ ] A repository with more than 2,500 irrelevant entries scans its selected
      app without materializing those entries.
- [ ] Presence-only favicon/social-preview assets preserve report parity.
- [ ] Every source rejection identifies kind, limit, observed value, and unit.
- [ ] Invalid environment budgets fail validation and cannot exceed compiled
      ceilings.
- [ ] Users can select a nested project and only that project's relevant source
      is retained.
- [ ] The same commit/path/category/version tuple produces a cache hit and a
      fresh scan ID; a changed tuple misses.
- [ ] A repository made private after caching cannot receive its cached report.
- [ ] Only projects within the CLI's source budget can enter async processing.
- [ ] Async duplicate delivery is idempotent and source archives are never
      stored in Neon or queue messages.
- [ ] Privacy/docs match actual cache and job retention.
- [ ] `pnpm ci:test-api`, `pnpm ci:test-web`, `pnpm ci:test-e2e`,
      `pnpm db:check`, `pnpm typecheck`, `pnpm check`, `pnpm build`, and
      `pnpm audit:self` all pass.
- [ ] No unrelated files, rule scoring, or private-repository support changed.

## STOP Conditions

Stop and report instead of improvising if:

- The authoritative source-retention contract cannot reproduce report parity
  between a full local fixture and retained hosted materialization.
- GitHub tree/blob acquisition would require more requests than the configured
  synchronous request budget and the streaming fallback cannot safely handle
  the repository.
- A project path requires executing workspace tooling or repository code to
  discover dependencies.
- Streaming extraction weakens traversal, link, duplicate, conflict, secret,
  abort, or cleanup guarantees.
- The cache cannot revalidate repository publicness before returning a hit.
- Production runtime credentials would need direct broad table access.
- Async processing requires source contents in queue messages or durable job
  rows.
- The selected Vercel queue feature is unavailable for the project's plan or
  region. Keep the dispatcher disabled and report the infrastructure decision.
- Any focused verification command fails twice after a reasonable correction.

## Maintenance Notes

- Every new scanner rule that reads a new path must update the source
  requirements contract and parity fixture.
- Every scanner/report/prompt/hosted schema change must invalidate cache keys.
- Cache and queue payloads are untrusted durable data; validate them on every
  read even when written by this application.
- Keep the async provider behind `ScanDispatcher`. Vercel Queues is an
  infrastructure choice, not a domain dependency.
- Review source-budget telemetry quarterly. Raise defaults only from measured
  demand and keep compiled hard ceilings.

## External References

- GitHub tree API limits and truncation behavior:
  `https://docs.github.com/en/rest/git/trees`
- Vercel Queues delivery, retries, idempotency, and consumer triggers:
  `https://vercel.com/docs/queues`
- Vercel Function duration configuration:
  `https://vercel.com/docs/functions/configuring-functions/duration`
