# Plan 012: React Router (framework mode) adapter

> **Executor instructions**: This plan adds a `react-router-framework`
> adapter so shadscan audits React Router v7 applications running in
> framework mode — one of the official shadcn CLI templates. Work the
> phases in order; each lands independently and must leave every existing
> adapter byte-identical (fixtures prove it). Bump
> `BUNDLED_RULESET_VERSION` to the next unused date-version **at execution
> time** — do not assume a number is free, the community Windows PR (#8)
> may still claim one. Regenerate `docs/rules.md`, keep
> `scripts/verify-version-pins.mjs` green, add an Unreleased changelog
> entry per phase, and update `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `grep -rn "react-router\|reactRouter" packages/cli/src/discovery.ts packages/cli/src/rules/source-files.ts`
> If the adapter already exists, reconcile against what shipped instead of
> re-implementing.

## Status

- **State**: PLANNED
- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM — lower than 010/011 because the document shell and
  route modules are ordinary TSX, so no new parsing discipline is needed.
  The real hazard is a **namespace collision**: React Router framework
  mode keeps its code in `app/`, the same directory name Next's App
  Router uses, and `detectAppDir` (`discovery.ts`) already populates
  `paths.appDir` for any project with one. Every rule that reads
  `paths.appDir` must be confirmed to guard on `versions.next` first.
- **Depends on**: none; plan 011 shipped in 0.4.0 (`0edefab`)
- **Category**: feature/adapter
- **Planned at**: 2026-07-25

## Scope decision (read this first)

React Router v7 has three ways to run, and only one earns an adapter:

1. **Declarative mode** — `<BrowserRouter>` in a Vite SPA. No framework
   conventions, no document shell of its own. Stays on `vite-react`.
2. **Data mode** — `createBrowserRouter` with loaders/actions, still a
   SPA whose shell is `index.html`. Stays on `vite-react`.
3. **Framework mode** — `@react-router/dev`, `react-router.config.ts`,
   `app/root.tsx` as the document, `app/routes.ts` as route config, SSR
   by default. **This is the adapter.** It is what Remix became, and it
   is the `react-router` template the shadcn CLI ships.

Detection must therefore key on the *framework-mode* markers, not on the
`react-router` package alone — that package is present in all three
modes and in countless plain SPAs. Getting this wrong would reclassify a
large number of existing `vite-react` projects, which is the single
worst outcome available in this plan.

Explicitly out of scope:

- **Remix v2** (`@remix-run/react`). Its conventions are nearly identical
  (`app/root.tsx`, `app/routes/`, `meta` export, `ErrorBoundary`), so the
  rule branches this plan writes would mostly apply unchanged. It is a
  follow-up plan, not a redesign — deferred only to keep v1 focused and
  because shadcn's template targets React Router.
- **`app/routes.ts` config-driven route resolution** beyond the simple
  literal forms (below). Programmatic route trees built by loops or
  helpers record a boundary reason.

## Current State (verified 2026-07-25)

- No `react-router` mention in discovery or source patterns. A framework
  mode app today has `react`, `react-router`, `@react-router/dev`, and
  `vite` — and a `vite.config.ts` — so it lands on **`vite-react`** if a
  vite entry exists, otherwise `generic-react`. Its `app/root.tsx`
  document is never read as a shell, so language, metadata, and
  shell-mount rules under-report.
- **The `app/` collision is real but currently contained.**
  `detectAppDir` returns `<root>/app` for any project that has one
  (`discovery.ts`), so a React Router project already gets a non-null
  `paths.appDir`. Every rule reading it was checked:
  - Guarded by `versions.next`: `html-lang-present`,
    `theme-provider-mounted-in-shell`, `mounted-component-files`,
    `toast-runtime`, `metadata-title-description-complete`,
    `social-preview-present`, and the `getAppRelativePatterns` callers in
    `high-confidence.ts`.
  - Adapter-gated to Next: `not-found-recovery-present`,
    `route-loading-boundary-present`.
  - **Unguarded and `core`-adapter: `error-state-retry-present`**
    (`getErrorFilePatterns`, line ~46). It globs `app/**/error.{jsx,tsx}`
    for any project. On React Router that finds nothing (error handling
    is an `ErrorBoundary` export, not an `error.tsx` file), so it is a
    silent no-op today rather than a false positive — but Phase 1 must
    add a regression fixture proving that, because it is the one place
    the collision could bite.
- Adapter plumbing shape settled across 009–011: union + schema enum +
  `versions` field + contract pin move together. Schema is **7** → this
  plan takes it to **8**. Ruleset is `2026.07.37`.
- Framework-mode project shape (React Router v7): `react-router.config.ts`
  at root (`ssr: true` by default); `@react-router/dev` in
  devDependencies; `vite.config.ts` using the `reactRouter()` plugin;
  `app/root.tsx` exporting a `Layout` component that renders
  `<html lang>`, `<head>` with `<Meta />` and `<Links />`, `<body>` with
  `<Scripts />`, plus a default export and usually an `ErrorBoundary`;
  `app/routes.ts` exporting a route config built from `index()`,
  `route()`, and `layout()` helpers, or `flatRoutes()`; route modules
  under `app/routes/`; per-route `meta` exports returning
  `[{ title }, { name: "description", content }]`; `loader`/`action`
  exports; optional `HydrateFallback` export for pending UI; tsconfig
  `~/*` → `./app/*` in the official template (note: `~`, not `@`).
  simple-icons has both `reactrouter` and `remix` marks (verified).

## Phase 1 — Detection, plumbing, and collision proof

1. Add `"react-router-framework"` to `FrameworkAdapter`, the report
   schema enum, and `FRAMEWORK_LABELS` ("React Router"). Add
   `versions.reactRouter` (from `react-router`). Bump
   `AUDIT_REPORT_SCHEMA_VERSION` to 8 and the contract pin in
   `lib/shadscan-api/protocol.ts` in the same commit.
2. Add `paths.reactRouterAppDir` (the `app/` directory when framework
   mode is detected) and `paths.reactRouterRoot` (`app/root.tsx|jsx`,
   null when absent). Keep these separate from `paths.appDir` rather
   than reusing it — `appDir` means "Next App Router" to a dozen call
   sites and must keep meaning exactly that.
3. Detection, placed **before** `vite-react` and after the Next branch,
   following the extracted-helper pattern
   (`detectReactRouterFramework(options, fallthroughEvidence)`).
   Requires **all** of: the `react-router` dependency, a framework-mode
   marker (`@react-router/dev` dependency **or** a
   `react-router.config.{ts,js,mjs}` file), and `app/root.{tsx,jsx}`.
   Anything less falls through with evidence naming what was missing —
   in particular, `react-router` alone must keep resolving to
   `vite-react`, and a test must assert that explicitly.
4. Add `app/routes.ts` and `app/root.tsx` to the source patterns only if
   the existing `app/**/*.{js,jsx,ts,tsx}` glob does not already cover
   them (it does — verify and note, do not duplicate).
5. Discovery tests: framework-mode fixture detects; declarative-mode SPA
   (`react-router` + `vite` + `src/main.tsx`, no `@react-router/dev`)
   stays `vite-react`; data-mode SPA stays `vite-react`; config-file-only
   marker (no `@react-router/dev` dep) still detects; missing `root.tsx`
   falls through with evidence; **a Next App Router project with `next`
   plus a stray `app/` still resolves `next-app-router`** (ordering
   regression).
6. **Collision proof**: a fixture asserting that a React Router project
   produces byte-identical results for `error-state-retry-present` and
   every other `core` rule that touches `paths.appDir`, versus the same
   project without the `app/` directory being interpreted as Next's.

## Phase 2 — Rule applicability and framework-mode branches

`app/root.tsx` is ordinary TSX, so unlike Blade and `.astro` these are
AST/regex checks over a normal source file — no new parsing contract.

- Document shell: add `paths.reactRouterRoot` as a candidate group to
  `html-lang-present`, `theme-provider-mounted-in-shell`,
  `mounted-component-files`, and `toast-runtime`. React Router renders
  the shell from a `Layout` export in the same file, so the existing
  content regexes work; the group just needs the path.
- `metadata-configured` / `metadata-title-description-complete`:
  recognize the route `meta` export — an exported function returning an
  array of `{ title }` and `{ name: "description", content }` objects.
  Reuse the object-literal field inspection already written for Next's
  `metadata` export rather than adding a second regex dialect.
- `not-found-route-present`: pass on an `ErrorBoundary` export in
  `app/root.tsx` that references `isRouteErrorResponse` (React Router's
  documented 404 path), or on a splat route module
  (`app/routes/$.tsx`). Fail message names both.
- `error-boundary-present` (currently `core`): recognize the
  `ErrorBoundary` export convention so framework-mode apps stop being
  told to add a `react-error-boundary`.
- `route-loading-boundary-present`: add the adapter. Framework mode is
  SSR with client navigation, so pending UI is real: pass when a
  `HydrateFallback` export exists, or when any component consumes
  `useNavigation()` state, or when route modules with `loader` exports
  render a Suspense fallback. Fail only when loaders exist with none of
  those. Confidence stays medium.
- `theme-hydration-safe`: **applies here** (unlike Astro) — framework
  mode is SSR by default and next-themes is commonly used. Check
  `suppressHydrationWarning` on the `<html>` element in `app/root.tsx`.
- `public-app-seo-files-present`: add the adapter (`public/` convention
  holds).
- Sweep for `versions.next`/`paths.appDir` assumptions as in 010/011;
  record deliberate deferrals with reasons.
- Ruleset bump, `docs/rules.md` regen, per-rule pass/fail fixtures.

## Phase 3 — Route-module surface planning

1. New `react-router-surface-planning.ts`. Route modules are found two
   ways, in order:
   - **`app/routes.ts` config** (preferred): parse the module with the
     TypeScript AST and collect the second string argument of `route()`
     and the first of `index()` / `layout()` calls — the literal forms
     the template generates. Non-literal arguments, spreads, loops, or a
     `flatRoutes()` call record a boundary reason and fall through to:
   - **Directory glob** of `app/routes/**/*.{tsx,jsx}`, which covers
     `flatRoutes` and hand-rolled trees.
2. One surface per route module, rooted at its default export, plus its
   `ErrorBoundary` and `HydrateFallback` exports as additional roots
   (they are real rendered UI and today are invisible).
3. `app/root.tsx`'s `Layout` export wraps route surfaces the way
   `wrapSeedWithAppWrappers` does for Next layouts — reuse that helper
   rather than writing a third variant.
4. Alias resolution needs no new work (`~/*` → `./app/*` flows through
   `resolveModuleName`), but add a fixture pinning the `~` form, since
   every prior adapter used `@`.
5. Determinism: sorted enumeration, double-run graph-projection equality
   test.

## Phase 4 — Product surfaces, docs, burn-in, release

1. Web scanner: e2e React Router archive in
   `test/e2e/github-fixtures.ts` (package.json with `@react-router/dev`,
   `react-router.config.ts`, `app/root.tsx`, `app/routes.ts`, one route
   module) and a scan-page spec asserting the "React Router" label.
   **Check `classifyScanInputPath` in `source-requirements.ts`** — this
   bit us twice; `.tsx` is already retained so no change is expected, but
   verify rather than assume.
2. Hero: add the React Router mark to `lib/framework-marks.ts`
   (simple-icons `reactrouter`, verified). That makes six marks — check
   the row still fits at 375px, and remember viewBoxes are tightened to
   glyph bounds (`6b5e330`), so measure the new one's `getBBox()` rather
   than assuming `0 0 24 24`.
3. Docs: framework lists in both READMEs; changelog entries collapse into
   the release section; site entry `changelog/<version>.md`.
4. **Burn-in (hard requirement, three public repos)**: the official
   `remix-run/react-router-templates` default template plus two real
   React Router v7 framework-mode apps. Triage every finding; fix false
   positives with regression coverage before release. This step has
   caught a real bug in both adapters that used it (svg favicons in 010;
   expression-valued meta and package-direct toasters in 011) — expect
   it to again. Watch especially for: `meta` exports returning arrays
   built by helpers rather than literals, and projects that keep routes
   outside `app/routes/`.
5. Ship as **0.5.0** (new adapter + schema 7→8). Release runbook and
   skill; `verify-version-pins.mjs` forces the advertised-pin bumps; the
   pnpm `minimumReleaseAge` note applies to announcement timing.

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

Plus for Phase 4: `pnpm test:e2e`, `pnpm test:api`, `pnpm test:web`, and
the full 14-gate release suite at the release commit.

## Open Questions / Risks

- **The `app/` collision is the whole risk.** Two frameworks now claim
  the same directory name. The mitigation is structural: a separate
  `paths.reactRouterAppDir`, detection that requires `next` for any Next
  adapter, and an explicit regression fixture. Resist the shortcut of
  reusing `paths.appDir` — it would couple two frameworks through one
  field and make every future `appDir` reader ambiguous.
- **False reclassification of existing users** is the worst failure mode:
  `react-router` appears in a huge number of plain Vite SPAs. Detection
  demands a framework-mode marker *and* `app/root.tsx`; the declarative
  and data-mode tests exist to keep that honest.
- **`routes.ts` is code, not config.** Only literal `route()`/`index()`/
  `layout()` forms are read; anything computed falls back to the
  directory glob, and `flatRoutes()` goes straight there. Both paths are
  legitimate — the boundary reason exists so a partially-understood
  config never masquerades as complete coverage.
- **Remix v2 will look tempting to fold in mid-plan.** It genuinely is
  nearly the same shape, which is exactly why it should be its own plan
  with its own burn-in rather than an untested `||` added to a detection
  branch.
- **`error-state-retry-present` is `core` and reads `appDir` unguarded.**
  Harmless today (it globs a Next filename React Router never uses), but
  it is the one rule that would silently change behavior if either
  framework's conventions shift. The Phase 1 fixture pins it.
- **Naming**: `react-router-framework` says which of the three modes is
  audited, leaving `react-router-declarative` available if declarative
  mode ever earns its own handling. The enum is append-only either way.
