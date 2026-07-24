# Plan 010: Laravel (Inertia + React) framework adapter

> **Executor instructions**: This plan adds a `laravel-inertia-react`
> framework adapter so shadscan audits the UI of Laravel applications built
> on Inertia and React — the stack the official Laravel React starter kit
> ships with shadcn/ui. Work the phases in order; each lands independently
> and must leave every existing adapter byte-identical (fixtures prove it).
> Bump `BUNDLED_RULESET_VERSION` in any phase that changes rule behavior,
> regenerate `docs/rules.md`, keep `scripts/verify-version-pins.mjs` green,
> and add an Unreleased changelog entry per phase. Update `plans/README.md`
> when complete.
>
> **Drift check (run first)**:
> `grep -rn "laravel\|inertia" packages/cli/src/discovery.ts packages/cli/src/rules/source-files.ts`
> If the adapter or `resources/js` source patterns already exist, reconcile
> against what shipped instead of re-implementing.

## Status

- **State**: PLANNED
- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH — three risks compound: (1) the scanner currently reads
  almost nothing from a Laravel repository, so source-pattern changes are
  load-bearing for every rule at once; (2) the document shell lives in a
  Blade template, and the engine must read it as text without growing a PHP
  or Blade parser; (3) Inertia page resolution runs through a Vite glob in
  `createInertiaApp`, which must be parsed conservatively or surface
  planning silently under-covers the app.
- **Depends on**: none technically; plan 009's public-repo burn-in is still
  outstanding and this plan repeats the same obligation — do not let both
  ship unburned
- **Category**: feature/adapter
- **Planned at**: 2026-07-24

## Scope decision (read this first)

"Laravel support" means **Laravel + Inertia + React**: PHP on the server,
React pages under `resources/js/`, shadcn/ui components installed by the
shadcn CLI's official `laravel` template. This is the stack the Laravel 12
React starter kit ships, and it is the only Laravel flavor whose UI our
React/TSX static engine can analyze.

Explicitly out of scope, stated honestly rather than half-supported:

- **Blade-only and Livewire applications** — their UI is Blade/PHP; we do
  not parse Blade beyond targeted text checks on known files (below), and
  shadcn/ui does not target Blade. These projects keep failing discovery,
  but with an error that names Livewire/Blade instead of the generic "does
  not declare React".
- **Inertia + Vue / Svelte** — shadcn-vue exists, but the AST engine is
  React-only. Detection must key on `@inertiajs/react` specifically so Vue
  apps are not misclassified.
- **PHP/Blade parsing in general** — the engine reads exactly two Blade
  surfaces as plain text with regexes: the root template
  (`resources/views/app.blade.php`) and the error pages directory
  (`resources/views/errors/`). Any rule needing more than a text regex
  against those files stays Next/Start-scoped.

## Current State (verified 2026-07-24)

- **The scanner cannot see Laravel source.** `SOURCE_PATTERNS` in
  `packages/cli/src/rules/source-files.ts:26` covers `app/`, `pages/`,
  `src/`, `components/`, `lib/`, `hooks/`, and `index.html` — not
  `resources/js/`. `STYLE_PATTERNS` similarly misses `resources/css/`.
  Every content rule is blind until this is fixed, which makes Phase 1 the
  load-bearing phase.
- Detection: `detectFramework` (`discovery.ts:341`) has no Laravel branch;
  a starter-kit app has `react` + `vite` in `package.json` but no
  `src/main.tsx`, so it lands on `generic-react`. A Blade-only app throws
  `UNSUPPORTED_PROJECT` ("does not declare React", `discovery.ts:470`).
- Client surface planning entry fallbacks (`client-surface-planning.ts:420`)
  know `src/main.*` and root `main.*` only — not `resources/js/app.tsx`.
- Adapter plumbing shape is settled from plan 009 (`935ef41`): union +
  schema enum + `versions` field + contract pin in
  `lib/shadscan-api/protocol.ts` move together; report schema is 5 and
  this plan takes it to 6.
- Laravel starter-kit shape (React, Laravel 12): `package.json` at repo
  root with `@inertiajs/react`, `laravel-vite-plugin`, `react`, `vite`;
  `composer.json` with `laravel/framework`; `artisan` at root; pages in
  `resources/js/pages/**/*.tsx`; app boot in `resources/js/app.tsx` calling
  `createInertiaApp` with
  `resolvePageComponent(`./pages/${name}.tsx`, import.meta.glob("./pages/**/*.tsx"))`;
  layouts in `resources/js/layouts/`; shadcn components in
  `resources/js/components/ui/`; `components.json` at root with `@/*`
  aliases mapped by `tsconfig.json` to `./resources/js/*`; the document
  shell in `resources/views/app.blade.php` (`<html lang>`, `@inertiaHead`,
  `@viteReactRefresh`); metadata via Inertia's `<Head>` component; server
  routing in PHP (`routes/web.php`) which we never parse.

## Phase 1 — Source coverage, detection, and plumbing

Goal: Laravel Inertia React projects are detected, and the scanner actually
reads their source. Nothing else changes.

1. Add `resources/js/**/*.{js,jsx,ts,tsx}` to `SOURCE_PATTERNS` and
   `resources/css/**/*.css` to `STYLE_PATTERNS`. This is global, not
   adapter-gated — the directory does not exist in Next/Vite/Start projects,
   and gating source discovery on detection order would create a cycle.
   Existing-adapter fixtures must prove byte-identical output.
2. Add `"laravel-inertia-react"` to `FrameworkAdapter`, the report schema
   enum, and the scan-page `FRAMEWORK_LABELS` map ("Laravel + Inertia").
   Add `versions.inertia` (from `@inertiajs/react`) and `versions.laravel`
   (from `composer.json` `require."laravel/framework"`, null when
   composer.json is absent or unreadable — a five-line JSON read, not a PHP
   parser). Bump `AUDIT_REPORT_SCHEMA_VERSION` to 6 and the contract pin in
   the same commit.
3. Detection, placed **before** the `vite-react` branch (Laravel apps also
   depend on Vite): `@inertiajs/react` dependency + `resources/js`
   directory + one Laravel marker (`artisan` file or `laravel-vite-plugin`
   dependency). Evidence lines for each signal. `@inertiajs/react` without
   Laravel markers falls through to `vite-react`/`generic-react` with an
   evidence note (Inertia's Rails/Phoenix hosts are not this adapter's
   problem).
4. Add `paths.inertiaPagesDir` (default `resources/js/pages`, also accept
   `resources/js/Pages` — the pre-starter-kit capitalization is common in
   the wild) and `paths.bladeRootView` (`resources/views/app.blade.php`,
   null when absent).
5. Improve the `UNSUPPORTED_PROJECT` message: when `composer.json` declares
   `laravel/framework` and no React dependency exists, say the UI stack is
   Blade/Livewire and that shadscan audits React shadcn UIs (Inertia +
   React on Laravel), instead of the generic React error.
6. Discovery unit tests: starter-kit fixture detects the adapter with both
   pages-dir casings; Inertia-without-Laravel falls through with evidence;
   Blade-only Laravel gets the new error; a `src/main.tsx`-bearing Laravel
   app still resolves to `laravel-inertia-react` (ordering regression).

## Phase 2 — Rule applicability and Laravel-aware branches

Goal: framework-branching rules understand the Inertia + Blade split.
Ruleset bump; per-rule fixtures; regenerate `docs/rules.md`.

The recurring pattern: **content rules** read React source (now visible via
Phase 1) and need an Inertia branch where they key on Next/Start
conventions; **document-shell rules** read `app.blade.php` as text.

- `html-lang-present`: add a candidate group for `paths.bladeRootView`; the
  existing `<html lang` regex works on Blade text unchanged.
- `metadata-configured` / `metadata-title-description-complete`: pass on
  Inertia `<Head>` usage with a title (component form `<Head title="…">`
  or child `<title>`), checked across `resources/js/`; the Blade root
  template's `<title inertia>` alone is the fallback signal. Description
  via `<meta name="description">` inside `<Head>`.
- `favicon-present`: extend the file checks with `public/favicon.ico` (already
  covered) and a `FAVICON_LINK_PATTERN` text pass over `bladeRootView`.
- `social-preview-present`: og/twitter meta inside `<Head>` or the Blade
  root template (same HTML regex both places).
- `not-found-route-present`: pass on `resources/views/errors/404.blade.php`
  or an Inertia error page component (`resources/js/pages/error*.tsx` /
  `Error.tsx` convention); fail message names both options.
- `route-loading-boundary-present`: Inertia navigation shows the built-in
  progress indicator when `progress` is not disabled in `createInertiaApp`.
  Pass when `progress` is untouched or configured; fail only when
  `progress: false` and no `router.on("start")` handler exists. Applies via
  the adapter list; confidence stays medium.
- `theme-hydration-safe`: the starter kit manages theme via an appearance
  hook and inline script in Blade, not next-themes; keep the rule gated to
  its current adapters (next-themes on Laravel is rare) and record the
  decision.
- Document-shell candidate groups (`theme-provider-mounted-in-shell`,
  `mounted-component-files`, `toast-runtime`): add `resources/js/app.tsx`
  and `resources/js/layouts/**` shells; the ThemeProvider/toast mount in the
  starter kit lives in the layout components.
- `public-app-seo-files-present`: add the adapter (Laravel serves `public/`
  the same way).
- Sweep remaining `versions.next`/`paths.appDir` assumptions as in plan
  009; record deliberate deferrals (`error-state-retry-present`,
  `not-found-recovery-present` analyze React error-UI files and degrade to
  not-applicable — Blade 404 content is out of engine scope).

## Phase 3 — Render-graph surface planning for Inertia pages

Goal: every Inertia page is a render-graph surface, with persistent layouts
as wrappers.

1. New `inertia-surface-planning.ts`: one surface per file under
   `inertiaPagesDir`, rooted at the file's default export (the existing
   `getRecordDefault` resolver). Route key = page path relative to the
   pages dir (Inertia page names are exactly that).
2. Persistent layouts: when the page module assigns
   `Page.layout = (page) => <Layout>{page}</Layout>` or
   `Page.layout = Layout`, wrap the seed with the resolved layout
   component (mirrors `wrapSeedWithAppWrappers`); unresolvable layout
   expressions record a boundary reason.
3. `createInertiaApp` in `resources/js/app.tsx`: verify the pages glob
   matches the default (`./pages/**/*.tsx` / `./Pages/**/*.tsx` via
   `import.meta.glob` or `resolvePageComponent`). A non-default glob
   records a graph boundary reason ("Inertia page resolution uses a
   non-default glob; surfaces may be incomplete") rather than attempting
   to evaluate arbitrary expressions.
4. Alias resolution needs no new work (tsconfig `paths` drives
   `resolveModuleName`, proven in plan 009) — but add a fixture with
   `@/* → ./resources/js/*` to lock it.
5. Determinism: sorted enumeration, double-run graph-projection equality
   test (same shape as `start-surface-planning.test.ts`).

## Phase 4 — Product surfaces, docs, burn-in, release

1. Web scanner: e2e Laravel starter-kit archive in
   `test/e2e/github-fixtures.ts` (package.json + composer.json + artisan +
   Blade root + two pages) and a scan-page spec asserting the
   "Laravel + Inertia" label renders.
2. Docs: framework list in both READMEs and any docs-page prose; the
   changelog Unreleased entries collapse into the release section; site
   entry `changelog/<version>.md` at release time.
3. **Burn-in before release (hard requirement this time)**: audit at least
   three public Laravel Inertia React repositories (the official
   `laravel/react-starter-kit` plus two real applications) and triage every
   finding as true/false positive. Plan 009 shipped without this step;
   with a whole new source-coverage surface, this plan must not.
4. Ship as **0.3.0** (new adapter + schema 5→6). Follow `docs/releasing.md`
   and the release skill; `verify-version-pins.mjs` will force the
   advertised-pin bumps; the pnpm `minimumReleaseAge` note applies to
   announcement timing.

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

- **Source-pattern blast radius**: adding `resources/js/**` globally is the
  one change that touches every adapter's input space. The mitigation is
  mechanical: run the full fixture suite before/after Phase 1 step 1 alone
  and require byte-identical reports outside Laravel fixtures.
- **Blade text checks are regex-on-HTML**: fine for `<html lang`, `<title
  inertia>`, favicon links, and og-image tags; anything conditional
  (`@if`, components) silently reads as absent. Rules must fail toward
  "not found" with remediation text, never crash, and confidence must not
  exceed what text matching supports.
- **File-count budget**: Laravel repos carry `vendor/` (PHP deps). The
  glob ignores don't currently exclude it; add `**/vendor/**` to
  `PROJECT_IGNORES` in Phase 1 or large repos will burn the 2,000-file
  budget on PHP.
- **Pages dir casing**: starter kit uses `pages/`, years of Inertia docs
  used `Pages/`. Support both; evidence names which one matched.
- **Wayfinder / SSR variants**: starter kits offer SSR (`resources/js/ssr.tsx`)
  — treat it as an additional shell candidate, not a separate adapter.
- **Adapter naming**: `laravel-inertia-react` is verbose but leaves room
  for a hypothetical `laravel-livewire` without renaming; the schema enum
  is append-only either way.
- **shadcn CLI alignment**: the shadcn CLI's official `laravel` template is
  what makes this stack first-class shadcn; keep detection keyed to
  dependencies and directories, not to anything the shadcn CLI writes,
  so hand-rolled Inertia apps detect identically.
