# Changelog

All notable changes to shadscan will be documented in this file. Releases use
semantic versioning, with prereleases published under the npm `next` tag and
stable releases published under `latest`.

## Unreleased

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
