# Plan 009: TanStack Start framework adapter

> **Executor instructions**: This plan adds first-class TanStack Start
> support: a new `tanstack-start` framework adapter with detection, rule
> applicability, framework-aware rule branches, and render-graph surface
> planning. Work the phases in order — each lands independently and every
> phase must leave all existing adapters byte-identical (fixtures prove it).
> Bump `BUNDLED_RULESET_VERSION` in any phase that changes rule behavior,
> regenerate `docs/rules.md`, and add an Unreleased changelog entry per
> phase. Update `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `grep -n "tanstack" packages/cli/src/discovery.ts`
> If the adapter already exists, reconcile against what shipped instead of
> re-implementing.

## Status

- **State**: PLANNED
- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM — the render-graph phase touches surface planning, the
  most intricate subsystem; a wrong entry model silently degrades anatomy
  and navigation rules instead of failing loudly. The schema bump is a
  breaking change for strict JSON consumers and must ship in a minor
  version.
- **Depends on**: none (0.1.1 shipped)
- **Category**: feature/adapter
- **Planned at**: 2026-07-24

## Why This Matters

TanStack Start hit stable 1.0 in late 2025 and is the fastest-growing home
for new shadcn apps outside Next. Today those projects fall through
`detectFramework` to `generic-react` (or `vite-react` when a stray
`src/main.tsx` exists), which means:

- Next-only rules (`not-found-route-present`,
  `route-loading-boundary-present`, `theme-hydration-safe`,
  `favicon-present`) never run, even though Start has direct equivalents
  and is SSR-by-default — exactly the environment `theme-hydration-safe`
  exists for.
- `metadata-configured` has no branch for Start's `head()` route option, so
  a fully-configured Start app can be told it has no metadata.
- Surface planning finds no entry (`src/main.tsx` does not exist in a
  standard Start app), so the component render graph under-covers the app
  and anatomy/navigation rules see fewer surfaces than they should.

A deterministic auditor that misidentifies the framework undermines the
product promise. Full support is one new adapter — the architecture was
built for this.

## Current State (verified 2026-07-24)

- `FrameworkAdapter` union: `packages/cli/src/discovery.ts:8` — five
  values; `detectFramework` (`discovery.ts:341`) resolves in order:
  Next (dep + `app`/`pages` dir) → `vite-react` (deps + entry candidate
  from `detectViteEntry`, `discovery.ts:301`) → `generic-react`.
- Rule gating: rules declare `adapters: ["core"]` or explicit adapter
  lists; `shouldRunRule` (`packages/cli/src/audit.ts:442`) matches them.
  Non-core rules today: `favicon-present` + `not-found-route-present`
  (`src/rules/high-confidence.ts`), `route-loading-boundary-present`,
  `theme-hydration-safe`, `public-app-seo-files-present`.
- Core rules branch internally on project shape (e.g.
  `metadata-configured`, `high-confidence.ts:521`, keys off
  `versions.next` + `paths.appDir`/`pagesDir`, with an `index.html` branch
  for Vite).
- Report schema: adapter enum + `versions` object in
  `packages/cli/src/audit.ts:325`; `AUDIT_REPORT_SCHEMA_VERSION = 4`
  (`audit.ts:22`). The site pins it via
  `lib/shadscan-api/contracts.ts:67` (build fails on drift — good, that is
  the intended coupling).
- Surface planning dispatch: `component-render-graph/surface-planning.ts`
  branches on `adapter.startsWith("next-")` vs the client path;
  `client-surface-planning.ts:408` resolves entries from `index.html`,
  `paths.viteEntry`, or `src/main.{tsx,jsx}` fallbacks.
- Ruleset version: `BUNDLED_RULESET_VERSION = "2026.07.34"`
  (`packages/cli/src/scan.ts:12`).

### TanStack Start project shape (v1.x)

- Dependencies: `@tanstack/react-start` + `@tanstack/react-router`; Vite
  plugin `tanstackStart()` from `@tanstack/react-start/plugin/vite`
  (`vite` is also in devDependencies — ordering in `detectFramework`
  matters).
- Routes: file-based under `src/routes/` by default (`app/routes/` in
  older beta scaffolds); `src/routes/__root.tsx` calls `createRootRoute`
  with `head: () => ({ meta, links })` and a shell/root component that
  renders `<html><head><HeadContent /></head><body>…`.
- Route files call `createFileRoute("/path")({ component, pendingComponent,
  errorComponent, notFoundComponent, … })`; `src/routeTree.gen.ts` is
  generated (must be excluded from source scanning like other codegen).
- Router: `src/router.tsx` `createRouter({ defaultPendingComponent,
  defaultNotFoundComponent, defaultErrorComponent, … })`.
- SSR by default; `public/` serves static assets (favicon, robots,
  sitemap) exactly like Vite/Next.

## Phase 1 — Detection and adapter plumbing

Goal: Start projects report `adapter: "tanstack-start"` with evidence, and
nothing else changes.

1. Add `"tanstack-start"` to the `FrameworkAdapter` union and to the
   report schema enum; add `tanstackStart: string | null` to
   `ProjectVersions` and the schema `versions` object. Bump
   `AUDIT_REPORT_SCHEMA_VERSION` to 5 and update the pinned value in
   `lib/shadscan-api/contracts.ts` in the same commit (the build enforces
   agreement).
2. Add `detectRoutesDir` (checks `src/routes`, then `app/routes`) and a
   `routesDir` entry in `ProjectPaths`.
3. In `detectFramework`, branch on
   `dependencies["@tanstack/react-start"] && routesDir` **before** the
   `vite-react` check (Start apps also depend on Vite). Evidence lines:
   dependency found + routes directory location. A Start dependency
   without a routes directory falls through with an evidence note, not an
   error.
4. Plain `@tanstack/react-router` SPAs (no Start) intentionally stay
   `vite-react`/`generic-react` in this plan — note it in evidence when
   the router dep is present. A router-only adapter is a possible plan
   010; do not widen scope here.
5. Exclude `**/routeTree.gen.ts` wherever generated files are skipped
   (check the shared source-glob exclusions before adding a new mechanism).

Tests: discovery unit tests with a minimal Start fixture (dep + routes
dir + root route); assert adapter, evidence, versions, and that a
`src/main.tsx`-bearing Start app still resolves to `tanstack-start` (order
regression). Existing adapter fixtures stay byte-identical.

## Phase 2 — Rule applicability and Start-aware branches

Goal: the five gated rules and the framework-branching core rules
understand Start. Ruleset bump; each detection lands advisory-consistent
with its existing confidence (these extend applicability, they are not new
rules).

- `metadata-configured`: add a Start branch — look for `head(` returning
  `meta`/`title` in `routesDir` (root route first). Fail message names the
  `head()` route option.
- `not-found-route-present`: add `tanstack-start` to `adapters`; pass on
  `notFoundComponent` in any route file or `defaultNotFoundComponent` on
  the router.
- `route-loading-boundary-present`: add `tanstack-start`; pass on
  `pendingComponent`/`defaultPendingComponent` (the Start analog of
  `loading.tsx`).
- `theme-hydration-safe`: add `tanstack-start` (SSR default). The
  `<html>` element lives in the root route's shell component — verify the
  existing detection finds `suppressHydrationWarning` there; extend the
  search scope to `routesDir` if it only scans `appDir`.
- `favicon-present`: add `tanstack-start`; accept `public/favicon.ico`,
  an icon link in the root route's `head()` links, or the existing
  `index.html` fallback.
- `public-app-seo-files-present`: add `tanstack-start` (same `public/`
  convention).
- Sweep the remaining core rules for `versions.next`/`appDir` assumptions
  that silently skip Start (grep `paths.appDir`, `versions.next` under
  `src/rules/`); fix only where a rule would mis-report, and record each
  decision in the plan's completion notes.

Tests: per-rule pass/fail fixtures under the Start fixture project;
regenerate `docs/rules.md` (`pnpm docs:check` gates it).

## Phase 3 — Render-graph surface planning

Goal: route files are render-graph entries so anatomy, navigation, and
composition rules see the full app.

1. New `start-surface-planning.ts` beside `next-surface-planning.ts`:
   seed one surface per `createFileRoute` file in `routesDir` (component +
   pending/error/notFound components as roots), with the root route's
   shell as the document wrapper. Reuse the existing seed/budget
   machinery — `surface-plan-budget.ts` caps stay untouched.
2. Dispatch in `surface-planning.ts` on `adapter === "tanstack-start"`.
3. Path aliases: Start scaffolds use `~/*` or `@/*` via `vite-aliases.ts`
   — confirm alias resolution reads `tsconfig`/Vite config the same way
   for Start projects; extend fixtures if not.
4. Determinism: route files enumerate via the existing sorted-glob
   helpers; no new ordering sources.

Tests: render-graph fixtures (nested routes, layout route, pending +
notFound components); assert surfaces and boundary reasons; double-run
determinism assertion identical to existing graph tests.

## Phase 4 — Product surfaces, docs, and release

1. Web scanner e2e: add a Start archive to `test/e2e/github-fixtures.ts`
   and a scan-page spec asserting the adapter renders in results.
2. Docs: README framework list ("Next.js, Vite, TanStack Start, generic
   React"), `app/docs/page.tsx` prose where adapters are named,
   `packages/cli/README.md`.
3. Changelog: Unreleased entries per phase collapse into one release
   section; site entry `changelog/<version>.md` at release time.
4. Ship as **0.2.0** (new adapter + report schema 4→5 is a minor, not a
   patch). Follow `docs/releasing.md` and the shadscan-release skill; the
   pnpm `minimumReleaseAge` note applies to announcement timing.
5. Real-world burn-in before promoting anything score-affecting: audit at
   least two public TanStack Start repositories and triage every finding
   as true/false positive (convention from plans 001–005).

## Verification (every phase)

```bash
pnpm check
pnpm docs:check
pnpm --filter ./packages/cli typecheck
pnpm cli:test
pnpm typecheck
pnpm build
pnpm cli:smoke
```

Plus for Phase 4: `pnpm test:e2e`, `pnpm test:api`, `pnpm test:web`.

## Open Questions / Risks

- **Custom routes directory**: `tanstackStart({ tsr: { routesDirectory } })`
  can relocate routes. Parsing Vite config is out of scope; ship with the
  two-candidate check plus a warning when the Start dep exists but no
  routes directory is found. Revisit if real projects hit it.
- **Schema consumers**: bumping `AUDIT_REPORT_SCHEMA_VERSION` breaks any
  external consumer validating `schemaVersion: 4` strictly. The GitHub
  Action reads `score`/`grade` only (unaffected), but call the bump out
  prominently in the changelog.
- **Start API churn**: v1 is stable but young; pin fixture versions
  exactly and keep detection keyed to long-lived signals (dependency name,
  routes directory, `createFileRoute`) rather than plugin internals.
- **`next-hybrid-router` precedent**: `shouldRunRule` special-cases the
  hybrid adapter; `tanstack-start` needs no such case — keep the gate a
  plain membership test.
