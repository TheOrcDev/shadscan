# Plan 002: Make Next metadata and loading checks route-aware

> **Executor instructions**: Follow this plan step by step and run every
> verification command. Stop on any STOP condition instead of broadening the
> implementation. Update the status row in `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `git diff --stat 07a9eae..HEAD -- packages/cli/src/rules/metadata-title-description-complete.ts packages/cli/src/rules/route-loading-boundary-present.ts packages/cli/test/foundation-rules.test.ts packages/cli/test/state-rules.test.ts`

## Status

- **State**: DONE
- **Priority**: P0
- **Effort**: M
- **Risk**: MED - Next rendering classification changes across versions
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `07a9eae`, 2026-07-19

## Why This Matters

The metadata rule fails on the first incomplete metadata export even when the
root layout provides inherited title/description fields. The loading rule
flags any `await` anywhere in a page file and therefore cites a prerendered
blog route before reaching OrcDev's genuinely dynamic videos route. The score
and remediation are directionally useful, but the current evidence teaches an
executor to modify the wrong code.

## Current State

- `metadata-title-description-complete.ts:28-55` iterates source files and
  returns on the first metadata export.
- Next metadata is shallowly merged from root to leaf. A child that omits the
  top-level `description` inherits the root description.
- OrcDev root metadata has title and description at `app/layout.tsx:17-25`.
- OrcDev blog `generateMetadata` sets title and openGraph but omits top-level
  description. The rendered page still has the root description.
- `route-loading-boundary-present.ts:7-9` treats any `await` in a page file as
  an async route.
- OrcDev blog has `generateStaticParams`; `.next/prerender-manifest.json`
  confirms both posts are prerendered with no revalidation.
- OrcDev videos declares `dynamic = "force-dynamic"`, awaits YouTube data, and
  has no `loading.tsx` or useful Suspense fallback.
- OrcDev unsubscribe is a synchronous client page with an awaited event
  handler; it must not be classified as an async server route by this rule.

Before coding, read the checked-in Next documentation for metadata ordering and
merging under `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused tests | `pnpm --filter ./packages/cli exec vitest run test/foundation-rules.test.ts test/state-rules.test.ts` | exit 0 |
| Full CLI tests | `pnpm cli:test` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint/format check | `pnpm check` | exit 0 |
| Build | `pnpm cli:build` | exit 0 |
| Docs | `pnpm docs:check` | exit 0 |
| Self-audit | `pnpm audit:self` | score 100 and exit 0 |

## Scope

**In scope**:

- `packages/cli/src/rules/metadata-title-description-complete.ts`
- `packages/cli/src/rules/route-loading-boundary-present.ts`
- Optional new helper under `packages/cli/src/rules/next-route-analysis.ts`
- `packages/cli/test/foundation-rules.test.ts`
- `packages/cli/test/state-rules.test.ts`
- `packages/cli/src/scan.ts`
- `docs/rules.md`
- `CHANGELOG.md`

**Out of scope**:

- Running a Next build as part of shadscan
- Reading `.next` artifacts in production rule logic
- Requiring route-specific SEO copy when inherited metadata is complete
- Changing the `metadata-configured` rule
- OrcDev source changes

## Git Workflow

- Branch: `codex/002-next-route-semantics`
- Commit example: `fix: make next route checks rendering-aware`.
- Do not push unless instructed.

## Steps

### Step 1: Add metadata inheritance regressions

Add fixtures for:

1. Complete root layout metadata plus child `generateMetadata` with only title
   and openGraph. Expected: pass.
2. Root metadata missing description. Expected: fail with root-layout evidence.
3. Complete root metadata plus an explicitly empty child description. Expected:
   fail at the child because it overrides the inherited value.
4. No root metadata but one complete page metadata export. Preserve the current
   supported outcome or document a deliberate not-applicable/fail choice in the
   test name.

The first fixture must fail before implementation.

### Step 2: Evaluate final metadata coverage by route hierarchy

For Next App Router projects, inspect root layout metadata first. Model only the
top-level `title` and `description` fields needed by this rule:

- A non-empty root field is inherited by descendants that omit it.
- A descendant with a non-empty field overrides and remains valid.
- A descendant with an explicit empty/null field invalidates that route.
- Nested objects such as `openGraph` do not erase an unrelated top-level
  description.

Use AST object-property inspection where possible. Dynamic values should retain
the existing advisory/unknown semantics instead of being guessed from names.
Do not return based on arbitrary file enumeration order.

**Verify**: metadata-focused tests pass and evidence names the actual invalid
route or root file.

### Step 3: Add rendering-classification regressions

Create one fixture containing all three OrcDev patterns:

- a dynamic blog page with `generateStaticParams` and no loading boundary;
- a force-dynamic videos page with awaited data and no loading boundary;
- a synchronous client page with an awaited click handler.

Expected result: the rule fails and cites the videos page. Add a second loading
file under the videos segment and expect the rule to pass.

Also retain a negative fixture for a strongly dynamic route with no boundary.

### Step 4: Replace regex-wide async detection with page-render analysis

Parse the default page export rather than searching for any `await`. Classify a
route as requiring loading coverage only with strong runtime-dynamic evidence,
including:

- `dynamic = "force-dynamic"`;
- `revalidate = 0`;
- Next request APIs such as `cookies()`, `headers()`, or `connection()`;
- consumption of the page `searchParams` promise;
- other already-supported explicit dynamic markers, if present in the codebase.

Treat `generateStaticParams` without a strong dynamic marker as static for this
rule. A generic async server component without strong evidence must not be a
high-confidence score deduction; return pass/advisory according to the rule's
existing result contract. Never classify an async event handler as an async
route.

Scan every candidate before returning so evidence prefers a confirmed dynamic
route over an uncertain one. Sort paths for deterministic output.

**Verify**: the combined fixture cites `app/videos/page.tsx`, not blog or
unsubscribe.

### Step 5: Update public rule wording and version

Update the loading rule description/remediation to say runtime-dynamic routes,
not every async function. Bump the bundled ruleset revision, regenerate docs,
and add an Unreleased changelog entry.

**Verify**: `pnpm docs:check` exits 0.

### Step 6: Validate against OrcDev

Build, then run:

```bash
node packages/cli/dist/cli.js /Users/orcdev/projects/orcdev --json --no-roast
```

Expected:

- `metadata-title-description-complete` passes.
- `route-loading-boundary-present` still fails, but evidence points to
  `app/videos/page.tsx`.
- No finding points to the blog page as missing a loading boundary.

## Test Plan

- Metadata: inherited root values, explicit child overrides, empty override,
  dynamic unknown, deterministic ordering.
- Loading: force dynamic, revalidate zero, request API, searchParams, static
  generation, async event handler, nearest ancestor loading file, inline useful
  fallback.
- Use current fixture helpers and assertion style in the two existing suites.

## Done Criteria

- [x] OrcDev metadata finding passes.
- [x] OrcDev loading finding remains true and points to videos.
- [x] Static blog and client event-handler fixtures are not score deductions.
- [x] Existing dynamic-route coverage remains enforced.
- [x] Focused/full tests, typecheck, check, build, docs, and self-audit pass.
- [x] Ruleset/changelog updated and no OrcDev files changed.

## STOP Conditions

- The implementation needs `.next` output to distinguish the supplied static
  and force-dynamic fixtures.
- Next docs in the installed version contradict the inheritance assumptions.
- The fix would mark every async server component as static without checking
  dynamic markers.
- A public finding ID or JSON schema change appears necessary.

## Maintenance Notes

Keep the dynamic-signal list small and backed by official Next semantics. When
Next changes rendering APIs, add fixtures before changing classification.
