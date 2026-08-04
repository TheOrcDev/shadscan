# Changelog

All notable changes to shadscan will be documented in this file. Releases use
semantic versioning, with prereleases published under the npm `next` tag and
stable releases published under `latest`.

## Unreleased

## 0.10.0 - 2026-08-04

### Added

- A new advisory rule, `button-group-holds-only-buttons` (ruleset
  `2026.07.42`): shadcn's `ButtonGroup` joins its children into one shape,
  and its whole answer to focus is
  `[&>*]:focus-visible:relative [&>*]:focus-visible:z-10` — it lifts the
  focused child above its neighbours rather than lighting the group. That is
  right for buttons, which share a geometry and a ring. Around a text input
  it reads as broken: the input's ring is drawn around its own box, including
  the edge flush against the button, so the ring runs down the middle of a
  control that looks like a single pill. `InputGroup` is the component for
  that composition — its wrapper reacts to descendant focus and
  `InputGroupInput` gives up its own ring — so the rule points there.
  - The rule descends the whole subtree rather than reading direct children,
    because the shape that actually ships wraps the control in a form
    primitive (`ButtonGroup > FormControl > Input`).
  - It reports only text entry. `ButtonGroup` is an open container that
    legitimately holds buttons, selects, separators and arbitrary wrappers,
    and radio, checkbox and submit inputs carry no offset ring, so none of
    those are reported.
  - A group holding a single child is silent. `ButtonGroup` joins with
    `[&>*:not(:first-child)]`, so a lone control is joined to nothing:
    there is no seam and no ring to bisect. A conditional sibling still
    counts, since `{loading ? <Spinner/> : <Button/>}` renders one either
    way.
  - It ships advisory and does not affect scores. Burn-in across nine real
    shadcn projects found four instances and no false positives, but all nine
    share one author, so that is not yet an independent enough sample to
    justify moving anyone's score.

## 0.9.0 - 2026-08-04

### Added

- An MCP server: `shadscan mcp` serves the audit over the Model Context
  Protocol on stdio, with three read-only tools — `scan` (score plus
  actionables, filterable by category, severity, or workspace package),
  `list_projects`, and `explain_rule`. Every call re-scans the current
  file state rather than answering from a cache, results are neutral
  (no roast copy), tool calls can only read inside the roots the server
  was started with, and every response carries the engine, ruleset, and
  schema versions. The library API now also exports `scanWorkspace` and
  `discoverWorkspace`. The MCP SDK is bundled at build time, so the
  published package still installs the same six runtime dependencies;
  the packed-CLI smoke test audits the bundle to keep the SDK's HTTP
  transports out.

## 0.8.0 - 2026-07-30

### Added

- Interactive human scans and pre-commit setup now show an immediate,
  persistent four-phase progress checklist on stderr, while JSON, prompt, CI,
  piped, redirected, and explicitly non-interactive output remain unchanged.

## 0.7.0 - 2026-07-27

### Added

- Monorepo support. Running shadscan at a workspace root now audits every
  React application it finds and pools their findings into one score,
  rather than failing with "the nearest package does not declare React".
  Workspaces are discovered by walking the tree for `package.json` files,
  so pnpm, npm, yarn, bun, Turborepo, Nx and Lerna all work without
  configuration and without adding a YAML parser to the CLI.
  - Each package is classified as an application or a library, and only
    applications feed the score. A React library has no document shell, so
    it fails rules about page titles and favicons it should never satisfy;
    pooling those would penalise a repository for owning a design system.
    Libraries are still scanned and reported with their own score. The
    deciding signal is an application entry point rather than a
    `main`/`exports` field, because internal workspace packages are
    routinely consumed from source through a path alias and declare no
    entry at all.
  - The report lists every package with its own score, adapter and
    classification reason, plus any packages that were skipped and why, so
    the pooled number is explicable rather than mysterious.
  - `--list-projects` prints what discovery found without scanning, and
    `--project <path>` scans a single package.
  - A workspace containing one application takes the single-package path
    unchanged, so the common "app at the root plus shared packages" layout
    keeps its existing score.

### Changed

- The JSON report schema version is now 9. Findings and agent actionables
  gain `packageDir`, agent work items gain `packageDir`, the report gains
  `workspace` (null for single-package scans), and `framework.adapter`
  accepts `mixed` when pooled applications use different adapters. The
  GitHub Action (which reads `score` and `grade`) is unaffected.

### Fixed

- Agent work items are now grouped per package. Grouping matched one
  actionable per rule id, so a pooled report silently dropped grouped
  items for every package after the first and emitted the remainder as
  duplicate entries with no way to tell which package they referred to.
- The scan result page keys findings by package and rule rather than rule
  alone, which in a pooled report collapsed rows and could resolve a work
  item to another package's finding.
- `no-nested-interactive-controls` no longer reports a false positive for
  Base UI's `render` composition (ruleset `2026.07.41`). `<Button render={<Link
  />}>` passes the link through the owner's attributes, and the owner renders
  it *instead of* its own tag, so a single anchor reaches the DOM — but the
  JSX walker sees the link as a descendant of an interactive element and
  flagged it, the same way `asChild` would have before its explicit
  exemption. An element is now exempt only from the element whose attributes
  it is passed to: real nesting through `children` still fails, and an outer
  interactive ancestor still catches a `render` target composed below it.

## 0.6.1 - 2026-07-27

### Fixed

- App Router rules now discover route boundaries and metadata exports on
  Windows, where native path separators previously prevented glob and source
  directory matching (ruleset `2026.07.40`). Contributed by
  [@robert-dudley-p1](https://github.com/robert-dudley-p1) in
  [#8](https://github.com/TheOrcDev/shadscan/pull/8).

## 0.6.0 - 2026-07-27

### Fixed

- Three false negatives reported in
  [#10](https://github.com/TheOrcDev/shadscan/issues/10), all caused by
  rules matching within a single lexical scope while idiomatic React
  composition spreads the implementation across files (ruleset
  `2026.07.39`):
  - `theme-hotkey-present` now recognizes declarative registrations from
    `@tanstack/react-hotkeys` and `react-hotkeys-hook`, resolved through
    the import so a local hook of the same name does not qualify. The two
    libraries express "do not fire while typing" with opposite polarity —
    TanStack's `ignoreInputs` (whose default is conditional on the key
    spec) versus `react-hotkeys-hook`'s `enableOnFormTags` (already
    guarded by default) — so each is evaluated on its own terms. A key
    spec that is not a static literal, or options behind an identifier,
    still fails.
  - `mobile-nav-present` no longer requires `<SidebarProvider>`,
    `<Sidebar>` and a link in one file. The provider mount and the
    sidebar composition are looked up separately and then linked by
    resolving the provider's children, and the link may live in a nav
    sub-component one hop below `<Sidebar>`. An `app-sidebar` module that
    nothing mounts, one rendered outside the provider, and an empty
    sidebar shell all still fail.
  - `async-action-pending-state` now follows a pending value through JSX
    props into the component that owns the trigger, across at most two
    boundaries, tracking renames and recognizing `mutation.isPending`.
    Spread props, unresolvable or external targets, ambiguous exports and
    computed values all end the chain rather than being assumed sound,
    and the failure message says where it stopped.

  Projects using these idioms will see their score rise on upgrade
  without any code change; these three rules are worth 12 points
  combined.

### Changed

- Module resolution, previously reimplemented in five places, is shared
  by the rules that need it, and the confined TypeScript host and parsed
  compiler options are now built once per project instead of once per
  rule.

## 0.5.0 - 2026-07-25

### Added

- A `react-router-framework` adapter (ruleset `2026.07.38`): React Router
  v7 applications running in framework mode — one of the official shadcn
  templates — are detected from the `react-router` dependency plus a
  framework marker (`@react-router/dev` or `react-router.config.*`) and
  an `app/root` module. Declarative and data-mode routers keep using the
  Vite or generic adapter, since `react-router` alone is a plain SPA
  router. Document rules read `app/root.tsx`; metadata comes from the
  `meta` export; not-found coverage accepts an `ErrorBoundary` handling
  `isRouteErrorResponse` or a splat route; `error-boundary-present`
  understands the `ErrorBoundary` export convention; loader-backed route
  modules need `HydrateFallback`, `useNavigation` pending UI, or a
  Suspense fallback. The render graph seeds one surface per route module
  — read from literal `routes.ts` entries when possible, otherwise from
  directory discovery with a boundary reason — and treats `ErrorBoundary`
  and `HydrateFallback` exports as rendered surfaces in their own right.

### Changed

- The JSON report schema version is now 8: `framework.adapter` accepts
  `react-router-framework` and `versions` includes `reactRouter`. The
  GitHub Action (which reads `score` and `grade`) is unaffected.

## 0.4.0 - 2026-07-25

### Added

- An `astro-react` framework adapter (ruleset `2026.07.37`): Astro sites
  with React islands — the setup shadcn/ui officially documents for
  Astro — are detected from the `astro` and `@astrojs/react`
  dependencies plus `.astro` pages under `src/pages`. `.astro` files are
  read as text for document-shell checks (language, title, description,
  favicon, social preview, `404.astro`), their frontmatter is parsed as
  the TypeScript it is to discover which React components each page and
  layout renders, and the component render graph seeds one surface per
  `.astro` page or layout from those islands — server-rendered or
  `client:*` hydrated alike. Toast and theme-provider mounts are traced
  from `.astro` shells into their island components. Astro's `.astro`
  codegen cache is excluded from scanning, Markdown/MDX pages record an
  explicit graph boundary, and Astro sites without React get an error
  naming their UI stack.

### Fixed

- Hosted web scans now retain the files their adapters need. `.astro`
  templates, Laravel's `resources/views/**/*.blade.php` views, and the
  `artisan` marker were dropped during archive extraction, so scanning a
  Laravel or Astro repository through the web scanner or hosted API
  reported it as generic React. Local CLI scans were unaffected.

### Changed

- The JSON report schema version is now 7: `framework.adapter` accepts
  `astro-react` and `versions` includes `astro`. The GitHub Action
  (which reads `score` and `grade`) is unaffected.

## 0.3.0 - 2026-07-24

### Added

- A `laravel-inertia-react` framework adapter (ruleset `2026.07.36`):
  Laravel applications built on Inertia and React — the stack the official
  Laravel React starter kit ships with shadcn/ui — are detected from the
  `@inertiajs/react` dependency, a Laravel marker (`artisan` or
  `laravel-vite-plugin`), and a `resources/js/pages` directory (both
  casings). The scanner now reads `resources/js` source and
  `resources/css` styles, rules understand Inertia and Blade conventions
  (`<Head>` metadata, the Blade root view's language/favicon/social tags,
  `errors/404.blade.php`, Inertia's navigation progress indicator), and
  the component render graph seeds one surface per Inertia page with
  persistent `Page.layout` wrappers resolved. Composer `vendor/`
  directories are excluded from source scanning, and Blade-only or
  Livewire Laravel apps get an error that names their UI stack.

### Changed

- The JSON report schema version is now 6: `framework.adapter` accepts
  `laravel-inertia-react` and `versions` includes `inertia` and `laravel`.
  The GitHub Action (which reads `score` and `grade`) is unaffected.

## 0.2.0 - 2026-07-24

### Added

- A `tanstack-start` framework adapter (ruleset `2026.07.35`): TanStack
  Start projects are detected from the `@tanstack/react-start` dependency
  and a `src/routes` or `app/routes` directory instead of falling back to
  the generic React adapter. Framework-aware rules now understand Start
  conventions — `head()` metadata and favicon links, `notFoundComponent`,
  loader `pendingComponent` coverage, theme hydration in the root route
  shell, and document-shell checks against `__root.tsx` — and the
  component render graph seeds one surface per route file from its
  statically resolvable route options. Generated `routeTree.gen.ts` files
  are excluded from source scanning.

### Changed

- The JSON report schema version is now 5: `framework.adapter` accepts
  `tanstack-start` and `versions` includes `tanstackStart`. Consumers
  validating `schemaVersion: 4` strictly must accept the new value; the
  GitHub Action (which reads `score` and `grade`) is unaffected.

## 0.1.1 - 2026-07-23

### Added

- Local interactive scans now end with a large block-letter grade banner
  (for example `F 32/100`) rendered directly above the post-scan menu, so
  the verdict is the last thing on screen. Narrow terminals fall back to a
  single `Final grade` line; CI, piped, and plain-terminal output are
  unchanged.

## 0.1.0 - 2026-07-23

The first stable release. 0.1.0 ships the same audited content as
0.1.0-rc.7 and finalizes the release-candidate series:

- 59 deterministic rules across six weighted categories, with
  evidence-backed scoring, confidence handling, and a component-anatomy
  engine whose composition rules respect project-defined customization.
- Human, JSON, and paste-ready agent-prompt output; `--apply` launches an
  installed Claude Code, Codex CLI, or Grok Build with a private
  remediation handoff.
- An interactive post-scan menu with arrow-key selection that copies the
  agent handoff to the clipboard, prints it, launches an agent, or adds a
  version-pinned pre-commit score gate.
- `--fail-under` CI gates, a composite GitHub Action with job summaries
  and agent-ready tracked issues, and a hosted web scanner for public
  repositories.
- Stable publishes now move the npm `latest` tag; public examples pin
  exact versions.

## 0.1.0-rc.7 - 2026-07-23

### Changed

- Select post-scan menu options with the arrow keys and Enter instead of
  typed numbers, with an in-place highlighted cursor, wrap-around movement,
  vim-style j/k, number-key shortcuts, and Esc or q to keep just the score.
  The handoff option starts highlighted, so a single Enter copies the plan.
  Terminals without raw-mode support keep the numbered prompt, and all
  non-interactive surfaces are unchanged.

## 0.1.0-rc.6 - 2026-07-23

### Added

- End every interactive scan with a post-scan call to action: copy the agent
  handoff to the clipboard (printed as well), print it without copying,
  launch an installed agent, or add a pre-commit score gate — with Enter
  keeping just the score. Clipboard support uses platform utilities with an
  OSC 52 terminal fallback and degrades to printing when neither is
  available. Non-interactive, CI, `--json`, `--prompt`, and
  `--no-interactive` behavior is unchanged.

## 0.1.0-rc.5 - 2026-07-22

### Added

- Advance the bundled ruleset to `2026.07.34` (59 rules) with three advisory
  composition rules built on a shared component-anatomy engine: Select,
  DropdownMenu, and Command items composed inside their group parts,
  InputGroup composed from its own input, textarea, and addon parts, and
  Alert anatomy with at most one icon and a required title. Part discovery
  reads the project's own `components/ui` source, so user-defined anatomy
  extensions never fail, and uncertain composition across component
  boundaries is never reported.
- Add a composite GitHub Action at the repository root that runs the CLI in
  consumer CI: score and category table in the job summary, an optional
  `fail-under` score floor, and a single tracked issue embedding the
  paste-ready agent handoff.
- Add the `/rules` catalog and `/changelog` release-notes pages to the
  product site, both linked from the docs and the command menu.

### Changed

- Base the recommended agent prompt on the `--prompt` handoff so agents plan
  from fix, decide, and verify work items and surface decide items as owner
  questions before editing code.

## 0.1.0-rc.4 - 2026-07-22

### Added

- Advance the bundled ruleset to `2026.07.33` (56 rules) and add a
  high-confidence shadcn Button rule that requires position-correct
  `data-icon="inline-start"` or `data-icon="inline-end"` attributes on inline
  icons and spinners while excluding icon-only controls.
- Add bounded project discovery and selection for monorepos so the web scanner
  can audit one root or nested app instead of acquiring unrelated source.
- Add optional immutable-result caching and durable queued execution for larger
  eligible web scans, with token-protected polling and no source persistence.
- Add a guided manual and AI-agent entry point to the product site.

### Changed

- Stream GitHub archives through bounded source profiles, retain only
  scan-relevant inputs, and support sparse acquisition for small selected
  manifests.
- Redesign the repository and npm READMEs around CLI workflows, deterministic
  guarantees, CI usage, and agent handoff.
- Make the versioned agent-audit prompt the recommended documentation path.

### Fixed

- Bundle the hosted scanner worker into production traces for Vercel.
- Resolve GitHub branch and tag revisions to immutable raw commit SHAs before
  archive acquisition while preserving stable errors.
- Ignore irrelevant assets when applying retained-source limits and report the
  exact failed counter, configured threshold, observed value, and affected path.
- Keep package-manager selection local to each documentation code block so
  changing one example no longer changes every example on the page.
- Generate Next.js route types before the standalone TypeScript gate so fresh
  checkouts can resolve typed route-handler contexts.
- Keep the shadcn authoring CLI out of the production dependency graph and pin
  patched `sharp` 0.35.3 for the Next.js image runtime.
- Exclude worktree metadata and contribution docs from scanner production
  traces.
- Prevent responsive command-menu width changes from animating through
  overflowing intermediate layouts.

## 0.1.0-rc.3 - 2026-07-21

### Added

- Add a width-aware terminal score bar with deterministic, color-free-by-default
  output for CI and redirected streams.
- Add interactive post-scan actions and `--apply --agent <provider>` for
  validating and launching Claude Code, Codex CLI, or Grok Build installations
  with a private neutral remediation prompt.
- Add confirmed, version-pinned pre-commit score gates through the post-scan
  menu and `shadscan setup --pre-commit`, with safe POSIX-native-hook updates
  plus manual plans for hook managers, other interpreters, and complex hooks.

### Changed

- Correlate navigation landmarks through a bounded component render graph that
  preserves route surfaces, repeated instances, child projection, responsive
  visibility, and mutually exclusive branches without executing application
  code.
- Detect Next.js projects containing both App Router and Pages Router trees,
  audit both root shells and route-boundary families, and report them through
  the explicit `next-hybrid-router` adapter.
- Publish agent guidance at the versioned `/agent/v1.md` contract, retain
  `/agent.md` only as a mutable latest alias, and define fetched guidance as
  untrusted reference material rather than execution authority.
- Pack the npm artifact once, smoke-test that exact tarball, verify its SHA-512,
  and submit the same bytes to staged publishing.
- Advance agent prompts to version 5, include selected-project context, and
  distinguish immutable Git revisions from archive-byte snapshot digests.

### Fixed

- Scope label, control, and error-description ID correlation to the nearest
  component owner so unrelated functions in one source file cannot satisfy one
  another's accessibility checks.
- Compare packed CLI report schemas with the installed package's exported
  schema version instead of a stale duplicated smoke-test literal.
- Move hosted TypeScript parsing and rule evaluation into disposable,
  resource-limited workers that are terminated on request abort, contain parser
  stack failures, and receive no deployment secrets in their environment.
- Bound each hosted process to two active scans and reject excess work without
  queueing or consuming quota, using a retryable `SCAN_BUSY` contract.
- Bound distributed rate-limit calls with PostgreSQL lock and statement
  timeouts plus an abortable Neon transport deadline.
- Align development rate limiting with production's epoch-based sliding windows
  and atomic multi-rule quota consumption.
- Scan eligible React files at the project root, expose source coverage in the
  report contract, and prevent `--fail-under` from certifying partial scans.
- Use locale-independent code-unit ordering throughout reports and prompts so
  deterministic output remains byte-stable across runtime locales.
- Keep product decisions and confirmed fixes in separate agent work items so a
  grouped handoff never turns an optional decision into a mandatory pass gate.
- Discover package managers from bounded monorepo roots, recognize `bun.lock`,
  and target the selected application in generated scan and project-gate
  commands.
- Confine every TypeScript config and module resolver used by hosted audits to
  the materialized source, including inherited configs, directory globs, and
  symlinked paths.
- Download public GitHub archives without the server token, closing the
  visibility-change window, and preserve the documented GitHub timeout error
  across extraction and project-root validation.
- Reject API key IDs that resolve only through JavaScript object prototypes,
  preserving the stable unauthorized response for malformed credentials.
- Restrict agent handoff verification gates to bounded, shell-safe package
  script names so untrusted manifests cannot inject executable instructions or
  unbounded command output.
- Confine hosted TypeScript config loading and shadcn alias probes to the
  materialized repository while preserving aliases across selected monorepo
  subdirectories.
- Require dark-mode and bare-key shortcuts to prove complete, exiting guards
  for inputs, textareas, selects, and contenteditable targets; unrelated target
  names and partial guards no longer earn safe-hotkey credit.
- Preserve render-graph uncertainty across Vite aliases, Next.js route surfaces,
  component composition, and bounded export resolution.
- Handle nullable Next.js `usePathname` values during production builds.

## 0.1.0-rc.2 - 2026-07-21

### Added

- Added complete Next.js Pages Router discovery and rule coverage, including
  `_app`, `_document`, route-level loading, error, not-found, metadata, theme,
  toast, and mounted-component analysis.
- Added CLI-first product documentation for output formats, category scopes,
  score thresholds, project paths, agent prompts, and AI-agent commit usage.

### Changed

- Advanced agent prompts to version 3, included namespaced test gates, and
  required agents to inspect and receive authorization for repository-owned
  scripts before execution.
- Aligned release tooling on Node.js 24 and pnpm 11 while preserving and
  directly testing the published CLI's Node.js 18 runtime contract.
- Built the CLI once per CI job while keeping local verification commands
  self-contained against fresh distributable output.

### Fixed

- Bundled the CLI argument parser so clean consumer installs no longer depend
  on Commander's expired historical npm registry signing key while preserving
  Node 18 support.
- Kept Yarn's JSON command machine-readable with quiet dependency resolution
  and standardized Bun examples on the package's Node shebang.
- Corrected the downloadable agent skill to use the published scoped package.
- Required command-menu and shortcut findings to resolve to mounted application
  surfaces instead of awarding credit for orphaned components.
- Reported the exact hotkey evidence that satisfied command-menu and theme
  rules, and recognized equivalent lowercase and optional-chain shortcut
  syntax without accepting unsafe typing-target handlers.
- Returned complete Pages Router reports from the web scanner and aligned the
  hosted prompt contract with prompt version 3.
- Made hosted scan quota consumption atomic, enforced one end-to-end deadline,
  classified empty GitHub archives correctly, and rejected conflicting archive
  path shapes as stable nonretryable source errors.
- Separated migration and runtime database roles, preserving least-privilege
  access to the production rate-limit function.

### Security

- Removed original TypeScript source content from published source maps and
  pinned every privileged GitHub Actions dependency to an immutable commit.
- Kept private repository metadata out of public website surfaces and corrected
  the privacy policy to match the hosted scanner's operational telemetry.

## 0.1.0-rc.1 - 2026-07-20

### Added

- Deterministic audits across 55 rules and six weighted categories.
- Human, JSON, and paste-ready agent prompt output.
- Project-path scanning for Next App Router, Vite React, and generic React apps.
- Evidence-backed scoring, confidence, remediation, and agent actionables.
- Optional score thresholds for CI.
- Hosted scan API with authenticated GitHub and sanitized snapshot sources.
- MIT licensing for the publishable CLI package.

### Changed

- The public npm distribution now uses `@shadscan/cli` while preserving
  `shadscan` as the installed executable and product name.
- Adopted the shadscan scan-frame and shadcn-slash mark across the install
  screen, repository scanner, social preview, and browser icon.
- Agent handoffs now group related findings into `fix`, `decide`, and `verify`
  work items, include discovered project gates and a version-pinned rerun
  command, and allow verified-no-change outcomes for score-neutral advisories.
- Audit reports use schema version 3 and paste-ready prompts use version 2.

### Fixed

- Empty-state checks now limit mapped collections to rendered surfaces and
  ignore chart transforms, SVG mark generation, and tooltip internals; heading
  checks treat separate component returns as mutually exclusive branches; and
  accessible-name checks resolve labels from local static mapped configuration.
- Browser contrast and mobile-overflow advisories now exclude Next route
  handlers, Pages API routes, and generated metadata images from page evidence.
- Empty-state checks now require actual query calls or mapped collection data,
  avoiding false failures from `nuqs` URL state, static table markup, and pages
  whose data-table component owns the empty-state branch.
- Reduced-motion checks now ignore stylesheet import names until application
  source actually uses an animation, transition, keyframe, or motion component.
- Shadcn wildcard aliases now validate their configured mapping roots without
  requiring unused destination directories such as `@/hooks` to exist yet.
- Async-action checks now recognize parenthesized pending-state branches and
  loading feedback supplied by `toast.promise`.
- Metadata completeness checks now treat object spreads as unknown field sources
  and honor later field overrides instead of reporting spread fields missing.
- Command-menu checks now recognize complete, mounted Fumadocs search dialogs
  and the provider's default Cmd/Ctrl+K shortcut, while excluding standalone
  `Command` comboboxes from app-level command-menu credit.
- Mobile-navigation checks now recognize explicit always-visible small-screen
  layouts and mounted shadcn Sidebar runtimes whose mobile Sheet has an app-level
  trigger.
- Focus-outline checks now inspect actual JSX focus targets, avoiding false
  failures on non-focusable popup containers such as hover-card content.
- Form-label checks now correlate matching dynamic `id`/`htmlFor` expressions,
  recognize `FieldLabel`, and ignore generated prop-forwarding input wrappers.
- Link-name checks now ignore generated native-anchor wrappers that forward their
  accessible content and attributes from rendered call sites.
- Semantic-interaction checks now recognize generated input-group addons whose
  click handler only delegates focus to the sibling form control.
- Dialog-name checks now correlate titles and content placed as siblings beneath
  the same dialog, sheet, alert-dialog, or composite dialog root.
- Not-found recovery checks now follow rendered local components through project
  TypeScript path aliases instead of stopping at the route file.
- Mobile-overflow checks now ignore sub-320px widths and fixed widths introduced
  only at min-width breakpoints while retaining max-width risks.
- Personal-data autocomplete checks now distinguish person-name fields from
  product, project, package, repository, and other object-name inputs.
- Heading-order checks now stop at MDX and Markdown composition boundaries,
  where rendered content can supply intermediate heading levels.
- Destructive-action advisories now require a native action or a custom control
  wired with a handler or submit semantics, and correlate confirmation within
  the same component flow; overflow advisories
  now inspect only layout classes, inline styles, and CSS declarations while
  respecting local overflow containment.
- Form label checks now ignore generated prop-forwarding primitives and report
  unlabeled `Input`/`Textarea` usage at rendered call sites, including shadcn
  `FormItem` and `FormLabel` composition.
- Navigation checks now recognize correlated custom mobile panels and compare
  landmark names only when responsive visibility allows them to coexist.
- Next metadata checks now honor root-to-leaf inheritance, and loading checks
  target runtime-dynamic routes instead of every async page or event handler.
- Toast setup checks now recognize mounted local wrappers backed by the
  `radix-ui` Toast export while continuing to reject placeholder toasters.
- Theme shortcut and global hotkey checks now recognize verified local
  typing-target guard predicates instead of reporting safe shortcuts as missing.

### Security

- Read-only local scanning with no source upload, telemetry, install script, or
  AI dependency.
- Archive extraction limits, source timeouts, authentication, and rate limits
  for the hosted API.

## 0.0.1

- Scaffolded the `shadscan` CLI package.
- Added project discovery for Next App Router, Vite React, and generic React apps.
- Added weighted scoring, confidence handling, JSON output, and `--fail-under`.
- Added first high-confidence rules for shadcn config, theme, metadata, favicon,
  route boundaries, and toast setup.
- Added AST-based accessibility checks for icon buttons, semantic interaction,
  form labels, and dialog titles.
- Added human report rendering with local roast copy and neutral CI/JSON output.
- Replaced the starter site with the shadscan product and dogfood page.
