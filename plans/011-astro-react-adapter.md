# Plan 011: Astro (React islands) framework adapter

> **Executor instructions**: This plan adds an `astro-react` framework
> adapter so shadscan audits the React shadcn UI inside Astro sites — the
> islands architecture that shadcn/ui officially documents as an
> installation target. Work the phases in order; each lands independently
> and must leave every existing adapter byte-identical (fixtures prove it).
> Bump `BUNDLED_RULESET_VERSION` to the next unused date-version at
> execution time — do not assume `.37` is free, the Windows-paths community
> PR (#8) may claim it first. Regenerate `docs/rules.md`, keep
> `scripts/verify-version-pins.mjs` green, add an Unreleased changelog
> entry per phase, and update `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `grep -rn "astro" packages/cli/src/discovery.ts packages/cli/src/rules/source-files.ts`
> If the adapter or `.astro` source patterns already exist, reconcile
> against what shipped instead of re-implementing.

## Status

- **State**: PLANNED
- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH — Astro is the first adapter whose *routes and document
  shell live in a file format the engine does not parse*. Every prior
  adapter's pages were TSX; Blade was only ever a text-checked shell.
  Here, `.astro` files are the router, the layouts, AND the place React
  components get mounted — so surface planning itself must read `.astro`
  files, and the discipline about how much of that format we understand
  is the whole risk.
- **Depends on**: none; plan 010 shipped in 0.3.0 (`973d979`)
- **Category**: feature/adapter
- **Planned at**: 2026-07-25

## Scope decision (read this first)

"Astro support" means **Astro + React islands + shadcn/ui**: `.astro`
pages and layouts own routing and the document, React components under
`src/components/` (installed by shadcn's official Astro guide) render the
interactive UI, mounted in `.astro` templates with or without `client:*`
directives.

The engine's contract with `.astro` files, stated precisely:

- **Frontmatter (between the `---` fences) MAY be parsed with the
  TypeScript parser.** It is plain TypeScript by Astro's own definition —
  imports, props, data fetching. Parsing it is not format creep; it is
  the same parser we already run on every `.ts` file, and it is the only
  reliable way to know which React components an `.astro` file imports.
- **The template (below the fences) is text.** Regex checks for HTML-ish
  signals (`<html lang`, `<title>`, meta tags, `<ComponentName` usage,
  `client:` directives) — never an AST, never expression evaluation,
  never control-flow understanding of `{condition && <X/>}`. Conditional
  islands silently read as present (the tag appears in text); that is
  acceptable and must fail toward under-reporting boundaries, not
  crashing.

Explicitly out of scope, stated honestly:

- **Astro sites without React** (`astro` dep, no `react`): discovery
  keeps rejecting them, with an error that names the situation — Astro
  UI in `.astro`/Vue/Svelte templates is not React shadcn UI. Detection
  keys on `@astrojs/react` so Vue/Svelte/Solid island sites are never
  misclassified.
- **MDX/Markdown pages** (`.md`, `.mdx` under `src/pages`): routes exist
  but carry no React surface planning in v1; a graph boundary reason
  records that MDX pages were skipped when any exist.
- **`.astro` template semantics**: slots, `Astro.props`, conditional
  rendering, `set:html` — all invisible to v1 beyond text matching.

## Current State (verified 2026-07-25)

- No `astro` mention anywhere in discovery or source patterns.
- **Detection today**: an Astro+React repo has `react`, `@astrojs/react`,
  `astro`, and `vite` is bundled *inside* astro (not always a direct
  dep); there is no `src/main.tsx`, so it lands on `generic-react`.
- **Source coverage today**: `src/**/*.{js,jsx,ts,tsx}` already covers
  the React components, so anatomy/a11y/form rules already see them. But
  `.astro` files are invisible — no document shell, no routes, no island
  mounting information. `SCRIPT_FILE_PATTERN` (`ast.ts:62`) filters the
  AST loader to `[jt]sx?`, so adding `.astro` to `SOURCE_PATTERNS` makes
  them regex-visible to text rules without ever entering the TS parser —
  the exact split we want (verified).
- **Surface planning today**: no client entry → the render graph seeds
  almost nothing; React islands are parsed as file records but never
  become surfaces, so mounted-component and nav rules under-report.
- Adapter plumbing shape is settled (plans 009/010): union + schema enum
  + `versions` field + contract pin move together. Schema is 6 → this
  plan takes it to 7. Ruleset is `2026.07.36`.
- Astro project shape (Astro 5, shadcn's documented setup): config at
  `astro.config.mjs|ts` with `react()` integration; pages in
  `src/pages/**/*.astro` (plus `.md`/`.mdx`); layouts conventionally in
  `src/layouts/*.astro` holding `<html lang>`, `<head>`, favicon links,
  meta; islands mounted as `<Component client:load|idle|visible|only>`
  (no directive = server-rendered, still UI); 404 page at
  `src/pages/404.astro`; tsconfig `@/*` aliases per the shadcn guide;
  codegen cache in `.astro/` at the repo root; simple-icons has an
  `astro` mark for the hero row (verified).

## Phase 1 — Source coverage, detection, and plumbing

1. Add `src/**/*.astro` to `SOURCE_PATTERNS` (regex-visible, never
   TS-parsed — see Current State) and `**/.astro/**` to
   `PROJECT_IGNORES` (Astro's codegen cache directory would otherwise be
   read as project source). Existing-adapter fixtures must prove
   byte-identical output.
2. Add `"astro-react"` to `FrameworkAdapter`, the report schema enum,
   and `FRAMEWORK_LABELS` ("Astro"). Add `versions.astro` (from the
   `astro` dependency). Bump `AUDIT_REPORT_SCHEMA_VERSION` to 7 and the
   contract pin in `lib/shadscan-api/protocol.ts` in the same commit.
3. Add `paths.astroPagesDir` (`src/pages` when it contains at least one
   `.astro` file) — do not collide with the existing Next
   `detectPagesDir` (root `pages/`); these are different directories and
   both may be null.
4. Detection, placed **before** `vite-react` in `detectFramework` (Astro
   sites may declare vite directly): `astro` dependency +
   `@astrojs/react` dependency + `astroPagesDir`. Evidence lines for
   each signal. Fallthrough evidence when `astro` is present without
   `@astrojs/react` ("astro site without the react integration") or
   without pages. Follow the extracted-helper pattern from plan 010's
   complexity refactor (`detectAstroFramework(options, fallthroughEvidence)`).
5. Improve `UNSUPPORTED_PROJECT`: when the `astro` dependency exists and
   React does not, say the site's UI stack is Astro templates (or a
   non-React island framework) and that shadscan audits React shadcn
   UIs — mirroring the Blade/Livewire message.
6. Discovery tests: full fixture detects; astro-without-react gets the
   named error; astro-with-react-but-no-pages falls through with
   evidence; ordering regression (astro + direct vite dep + `src/main.tsx`
   still resolves `astro-react`); `.astro/` cache dir is not scanned.

## Phase 2 — Rule applicability and Astro-aware branches

The document shell is `.astro` text; the pattern from Blade applies, but
the shell is *any owned `.astro` file containing `<html`* rather than one
known path (layouts are conventional, not enforced). A shared helper
(`findAstroDocumentShells(project)`) returns those files sorted; rules
consume it.

- `html-lang-present`: add an Astro candidate group from the shell
  helper; existing `<html lang` regex works on `.astro` text unchanged.
- `metadata-configured` / `metadata-title-description-complete`: pass on
  `<title>` + meta description found in `.astro` shells/pages (the HTML
  regexes already match; the branch only needs to scope which files
  count). Astro's `<SEO>` community components stay out of scope —
  evidence names the file that satisfied the check.
- `favicon-present`: `public/favicon.*` already passes (0.3.0 fix);
  add a `FAVICON_LINK_PATTERN` text pass over the shell files.
- `social-preview-present`: og/twitter meta regex over `.astro` files.
- `not-found-route-present`: add the adapter; pass on
  `src/pages/404.astro` (or `404.md`/`404.mdx`); fail message names the
  convention.
- `route-loading-boundary-present`: **deliberately not applicable** —
  Astro is MPA-first with no loader/pending concept; record the deferral
  (view-transition SPA mode is future work).
- `theme-hydration-safe`: stays next-themes-scoped (Astro themes via
  inline scripts); record the decision.
- Shell-mount rules (`theme-provider-mounted-in-shell`,
  `mounted-component-files`, `toast-runtime`): an island is "mounted in
  the shell" when a shell/layout `.astro` file imports it (frontmatter
  TS-parse) and its tag appears in the template (text). Phase 2 adds
  exactly that check — imports from frontmatter, tag presence by regex —
  reusing the Phase 3 frontmatter reader; no deeper template semantics.
- `public-app-seo-files-present`: add the adapter (same `public/`
  convention).
- Sweep remaining `versions.next`/`paths.appDir` assumptions; record
  deferrals as in plans 009/010.
- Ruleset bump, `docs/rules.md` regen, per-rule fixtures (pass + fail
  per branch, plus one fixture proving a `.astro` file never reaches the
  TS parser).

## Phase 3 — Render-graph surface planning for islands

Goal: every React component an `.astro` file renders becomes a surface.

1. New `astro-frontmatter.ts` (shared with Phase 2): split an `.astro`
   source on the `---` fences, parse the frontmatter with
   `createSourceFile` as plain TS, and return its import bindings
   (local name → module specifier). Malformed frontmatter returns null
   and records a boundary reason — never throws.
2. New `astro-surface-planning.ts`: for each `.astro` file under
   `src/pages` and `src/layouts` (sorted), resolve its React imports via
   the frontmatter reader + `resolveModuleName` (tsconfig aliases work,
   proven twice), then seed one surface per `.astro` file whose roots are
   the imported components whose tags appear in the template text
   (`<Name\b` regex, `client:*` directive or not — server-rendered
   islands are still UI). Route key = path relative to `src/pages`
   (layouts keyed under `layout:<name>`).
3. Boundary reasons: unresolvable imports; components imported but never
   tag-matched (skipped silently is fine — they are not rendered);
   `.md`/`.mdx` pages present ("MDX pages are not statically expanded");
   dynamic tags (`<Fragment`, spread-only usage) ignored by regex.
4. Determinism: sorted enumeration, double-run graph-projection equality
   test (same shape as the Start/Inertia planning tests).
5. Dispatch in `surface-planning.ts` under `adapter === "astro-react"`;
   `addClientSurfacePlan` keeps running after it, as for every adapter.

## Phase 4 — Product surfaces, docs, burn-in, release

1. Web scanner: e2e Astro archive in `test/e2e/github-fixtures.ts`
   (package.json + astro.config.mjs + layout with `<html lang>` + a page
   mounting one island + components.json) and a scan-page spec asserting
   the "Astro" label renders.
2. Hero: add the Astro mark to `lib/framework-marks.ts` (simple-icons
   `astro`, single path, verified available) — the supported-frameworks
   row then shows five marks; check the 375px line still fits (it wraps
   gracefully via flex-wrap if not).
3. Docs: framework lists in both READMEs; changelog Unreleased entries
   collapse into the release section; site entry `changelog/<version>.md`.
4. **Burn-in (hard requirement, three public repos)**: one official
   shadcn-on-Astro example or template, plus two real Astro+React+shadcn
   sites (the astro-shadcn starter ecosystem has several with real
   usage). Triage every finding true/false-positive; fix false positives
   with regression coverage before release — plan 010's burn-in caught a
   real one (svg favicons), assume this one will too. Candidates for
   extra scrutiny: metadata rules double-counting when both a layout and
   a page carry `<title>`; island tag regex matching commented-out
   templates; multi-framework repos where Vue islands coexist.
5. Ship as **0.4.0** (new adapter + schema 6→7). Release runbook +
   skill; `verify-version-pins.mjs` forces the advertised-pin bumps;
   pnpm `minimumReleaseAge` timing note applies to the announcement.

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

- **Frontmatter parsing is the line we hold.** Parsing frontmatter as TS
  is safe and load-bearing; the temptation to "just also" understand the
  template will recur at every false negative. The answer stays no — a
  boundary reason beats a wrong expansion. Any template need beyond tag
  presence is a future plan.
- **Two `pages` conventions now exist** (Next root `pages/`, Astro
  `src/pages/`). Detection order and the separate `astroPagesDir` path
  keep them apart, but a repo with both (a Next app with a stray
  `src/pages/*.astro`?) resolves by dependency checks first — `next` wins
  before astro is considered. Test it anyway.
- **Islands rendered only via MDX or content collections** produce no
  surface in v1 (boundary reason). Sites that are mostly-MDX blogs will
  under-report render surfaces while still getting document-shell and
  component-level rules — honest, but worth saying in the changelog.
- **`client:only="react"` components** never SSR and may import
  browser-only APIs; the graph treats them like any island (static
  analysis is unaffected), but the burn-in should include one.
- **Multi-integration sites** (`@astrojs/react` + `@astrojs/vue`):
  detection still resolves `astro-react`; Vue files are invisible;
  evidence notes React-islands-only coverage.
- **Astro's own `Image`/`Fragment`/built-in components** appear as tags
  in templates but are not project imports — the import-driven root
  seeding naturally excludes them; keep it that way rather than
  special-casing names.
- **Naming**: `astro-react` mirrors `laravel-inertia-react` — the
  qualifier says which island framework we audit, leaving room without
  ever renaming the enum value.
