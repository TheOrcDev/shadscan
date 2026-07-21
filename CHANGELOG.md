# Changelog

All notable changes to shadscan will be documented in this file. Releases use
semantic versioning, with prereleases published under the npm `next` tag and
stable releases published under `latest`.

## Unreleased

### Changed

- Pack the npm artifact once, smoke-test that exact tarball, verify its SHA-512,
  and submit the same bytes to staged publishing.
- Advance agent prompts to version 5, include selected-project context, and
  distinguish immutable Git revisions from archive-byte snapshot digests.

### Fixed

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
