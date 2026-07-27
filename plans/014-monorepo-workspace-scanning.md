# Plan 014: Monorepo workspace scanning

> **Executor instructions**: This plan teaches shadscan to audit every
> React application in a monorepo in one run, pool their results into a
> single score, and show the per-package breakdown in the report. Work
> the phases in order; each lands independently and must leave
> single-package scans **byte-identical** (fixtures prove it). Bump
> `BUNDLED_RULESET_VERSION` only if rule behavior changes — Phases 1–3
> should not change any rule. The report schema **does** change; bump
> `schemaVersion` and the `lib/shadscan-api/protocol.ts` contract pin in
> the same commit. Regenerate `docs/rules.md`, keep
> `scripts/verify-version-pins.mjs` green, add an Unreleased changelog
> entry per phase, and update `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `grep -rn "workspace\|monorepo" packages/cli/src/discovery.ts packages/cli/src/scan.ts`
> If workspace discovery already exists, reconcile against what shipped
> instead of re-implementing.

## Status

- **State**: PLANNED
- **Priority**: P1 — running shadscan at a monorepo root today is a dead
  end, and monorepos are the default shape for the shadcn audience
  (`shadcn init --monorepo` is a documented first-class template).
- **Effort**: XL
- **Risk**: HIGH — this is the first change to the **shape** of a report
  rather than its contents. Every consumer (the GitHub Action, the
  hosted API, the web scan page, the agent handoff) reads a report that
  has always described exactly one project. The scoring risk is
  described in the scope decision below and is the part most likely to
  produce a result users reject.
- **Depends on**: none
- **Category**: feature
- **Planned at**: 2026-07-27

## Current State (verified 2026-07-27, at HEAD `8c97bc2`)

There is **no workspace awareness anywhere in the CLI**. `grep -rn
"workspace\|monorepo" packages/cli/src` returns one unrelated regex.
`findProjectRoot` (`discovery.ts:134`) walks up from the cwd and returns
the first directory containing a `package.json` — nothing more.

Measured against a four-package fixture (`apps/web` Next, `apps/admin`
Vite, `packages/ui` React library, `packages/utils` no React):

| Invocation | Result |
|---|---|
| `shadscan` at the workspace root | **`UNSUPPORTED_PROJECT`** — "The nearest package does not declare React" |
| `shadscan apps/web` | works — 36 F, `next-app-router`, `@acme/web` |
| `shadscan packages/ui` | works — 40 F, `generic-react` |
| `shadscan packages/utils` | `UNSUPPORTED_PROJECT` (correct — no React) |

So the per-package path already works; the CLI takes a `[path]`
argument. **The entire gap is the root experience and aggregation.**

The hosted path is further along and solves a different half of the
problem: `discoverGitHubProjectCandidates`
(`lib/shadscan-api/github-tree.ts:106`) finds every `package.json`
directory that also contains a project signal, and the web scan page
makes the user **pick one** from a `<select>` (proven by the
"selects and scans one project from an ambiguous monorepo" e2e test).
It scans one project and reports one score.

## Scope decision (read this first)

### Libraries must not be pooled with applications

This is the decision the feature lives or dies on. From the table above,
`packages/ui` — a perfectly good component library — scores **40 F**,
with these category ratios:

```
foundation(0%)  interaction(30%)  states(0%)
accessibility(100%)  production-polish(100%)
```

`foundation` is 0% because the library has no `html lang`, no favicon,
no theme provider and no document metadata. It should not have any of
those. Those rules are marked *applicable* and scored zero, so a naive
pooled score would punish a monorepo for the crime of having a design
system. "My score dropped because my component library has no favicon"
is the kind of result that makes people stop trusting the number.

Therefore: **classify each package, and pool only applications.**
Libraries are still scanned and still reported with their own score —
their accessibility findings are genuinely useful — but in a separate
section that does not feed the headline number.

Classification is a heuristic and must be reported, never silently
assumed. Treat a package as an **application** when it has a framework
adapter that implies an app shell (`next-*`, `vite-react`,
`tanstack-start`, `astro-react`, `react-router-framework`,
`laravel-inertia-react`) **or**, for `generic-react`, when it has an app
entry — an `index.html`, or an `app/`/`pages/` directory. Treat it as a
**library** when it resolves to `generic-react`, declares
`main`/`module`/`exports`, and has no app entry. Anything ambiguous is
reported as `unclassified` and pooled as an application, because
under-reporting an app is worse than over-reporting one.

This design has a property worth protecting with a test: for the very
common "app at the repository root plus shared `packages/*`" layout, the
pooled score **equals today's score**, because the library packages do
not enter the pool. Upgrading must not move that number.

### Pool at the finding level, not by averaging scores

The score is not a point total — it is a weighted ratio over six
categories (`getCategoryScores`/`getTotalScore`, `audit.ts:514-564`).

Pool the **findings** from every application package and run the
existing `getCategoryScores` → `getTotalScore` over the combined set.
Be honest about what this weighting means: every application contributes
one finding per applicable rule, so applications are weighted **roughly
equally** regardless of size — a five-file app and a five-hundred-file
app move the pooled number about the same amount. That is a defensible
semantic (an app is an app; each one ships to users), and it is stated
here so nobody later "discovers" it as a bug. Size-proportional
weighting was considered and rejected: it makes the score unexplainable
from the per-package table, and explainability is the product.

The actual advantages of finding-level pooling over score averaging:
one scoring implementation instead of two that drift, not-applicable
rules genuinely drop out per package, and category applicability is
computed over the union — a category inapplicable in one app but
applicable in another is handled by the existing math for free. It also
degrades exactly to current behavior when there is one application.

### Verified against the code (probed 2026-07-27)

- **Duplicate rule ids are safe in the CLI pipeline.** Nothing in
  `audit.ts` or `render-human.ts` keys findings by id;
  `PRODUCT_DECISION_DETAILS[finding.id]` is a lookup, not a dedup. A
  pooled findings array with three `theme-provider-configured` entries
  scores correctly.
- **Duplicate rule ids break the web UI.** `app/scan/result-details.tsx`
  keys rendered findings by `finding.id` (lines 183 and 376), and the
  actionable-selection state is keyed the same way. Pooled findings
  produce duplicate React keys and conflated checkbox state. Pooled
  findings therefore need a package identity on the finding itself
  (`packageDir` below), and the web UI must key by
  `` `${packageDir}:${id}` ``. This lands with Phase 4, but the schema
  field lands in Phase 2 so the data is there.
- **Cross-package imports stay unresolved — explicit non-goal.** When
  `apps/web` imports `@acme/ui`, resolution passes through
  `node_modules` (or resolves outside the package root) and the render
  graph records an external/boundary result. Pooling does not change
  that: each package is still scanned with its own root. Shared
  components are audited *in their own package's scan*, not through the
  consuming app's surfaces. Document this; do not attempt to fix it
  here — widening `isWithinProject` to the workspace root touches the
  scan-boundary safety envelope and deserves its own plan.

### Discovery: walk the tree, do not parse workspace manifests

The CLI has six runtime dependencies and no YAML parser. Adding one to
read `pnpm-workspace.yaml` is a real cost for a tool that sells
determinism and a small supply chain.

It is also unnecessary. Finding every non-`node_modules` `package.json`
that declares React gives the right answer for pnpm, npm, yarn, bun,
Turborepo, Nx and Lerna **uniformly**, needs no new dependency, and
matches what the hosted path already does — which is valuable in itself,
since the CLI and the web scan disagreeing about what a repository
contains would be its own bug report.

Detect the workspace *kind* by file presence only (`pnpm-workspace.yaml`,
`workspaces` in the root `package.json`, `turbo.json`, `nx.json`,
`lerna.json`) and report it as a label. Do not parse it for globs.

## Phase 1 — Workspace discovery and the `workspace` report field

No scoring changes. A single-package scan must produce a byte-identical
report except for the new field.

1. Add `packages/cli/src/workspace.ts`: `discoverWorkspace(rootDir,
   filesystemRoot)` returning the workspace kind, the root, and an
   ordered list of candidate packages with their classification and the
   reason for it. Ordering is `compareCodeUnits` on the relative path —
   determinism is the product promise and this list drives everything
   downstream.
2. Enforce a hard cap (start at 25 application packages) and record what
   was dropped. Silent truncation reads as "we audited everything".
3. Add the `workspace` field to the report schema (`null` for
   single-package scans) and bump `schemaVersion` 8 → 9, moving the
   `lib/shadscan-api/protocol.ts` pin in the same commit.
4. Add `--project <path>` to scan exactly one package explicitly, and
   `--list-projects` to print what discovery found without scanning.
   `--list-projects` is the debugging tool for every issue this feature
   will generate; build it first, not last.

**Tests**: fixtures for pnpm/npm-workspaces/turbo/nx layouts, a nested
workspace, a package that declares React but has no source, and the cap.
Assert a single-package report is unchanged apart from `workspace: null`.

## Phase 2 — Scan every application and pool the score

1. Add `scanWorkspace(rootDir, options)` beside `scanProject`. Keep
   `scanProject` exactly as it is — the hosted API and `--project` both
   depend on it, and it is the single-project contract.
2. Scan packages **sequentially**. The render graph and the parsed-file
   cache are per-project and memory-heavy; parallelism here buys wall
   clock and risks the determinism guarantee. Revisit only with numbers.
3. A package that throws (`UNSUPPORTED_PROJECT`, unreadable
   `package.json`) becomes a `skipped` entry with its reason. One bad
   package must never fail the run.
4. Pool findings from application packages, then reuse
   `getCategoryScores`/`getTotalScore`. Top-level `score` and `grade`
   become the pooled values, which is what keeps the GitHub Action
   working unchanged.
5. Decide `framework.adapter` for a pooled report deliberately. Proposal:
   report the adapter when every application agrees, otherwise a new
   `"mixed"` value with the per-package adapters available in
   `workspace.projects[]`. Consumers that switch on the adapter need a
   value they can reason about, not the first one that happened to sort
   first.
6. Findings gain a `packageDir` field (workspace-relative, `null` in
   single-package reports) so evidence stays navigable, the agent
   handoff can address the right directory, and web consumers can build
   unique keys. Evidence paths are re-prefixed with the package path
   during pooling — `normalizeFindingPaths` runs per package against the
   package root, so the pooled report must not leave two packages'
   `src/App.tsx` indistinguishable.

**Tests**: pooled score for two apps; a library present and provably
excluded; app-at-root-plus-libraries scoring identically to today; a
skipped package; determinism via a double run diff.

## Phase 3 — Show it in the result

The human report currently prints one adapter, one package name and one
grade banner (`render-human.ts:317`).

1. Above the banner, print a per-package table — path, adapter, kind,
   score, grade — sorted worst-first, so the thing needing attention is
   read first. Libraries appear in their own labelled block, and the
   label must say they do not affect the score, in the output itself and
   not only in the docs.
2. The grade banner shows the pooled grade, with a line naming how many
   applications it covers. A number that silently means something new is
   worse than no number.
3. List skipped packages with reasons. A user whose app was skipped for
   a missing React dependency must be able to see that without `--json`.
4. Keep the findings section grouped by package; do not interleave.
5. Narrow terminals fall back to a one-line-per-package list, matching
   the existing banner fallback.

**Tests**: snapshot the human output for a workspace, a single package
(unchanged), a workspace with skips, and a narrow terminal.

## Phase 4 — Hosted scan, Action, and docs

0. Web: switch every finding key and actionable-state key in
   `app/scan/result-details.tsx` from `finding.id` to
   `` `${finding.packageDir ?? "."}:${finding.id}` ``. This is a
   correctness fix, not polish — with duplicate keys React drops rows
   silently (see the probe results above).
1. Web: add "Scan all projects" beside the existing per-project select.
   The select stays — scanning one project is often what someone wants,
   and it is the cheap path. Check the hosted timeout budget against a
   25-package cap **before** building this; if it does not fit, ship the
   cap lower for hosted scans and say so in the UI rather than timing
   out.
2. Confirm the Action still passes with a pooled score, and add a
   workspace case to its test matrix.
3. Document the classification rules, the pooling behavior and
   `--project`/`--list-projects`. The classification heuristic *will*
   get something wrong; the docs need to tell people how to see what it
   decided and how to override it.

## Testing strategy

The unit-level pattern already exists: `discovery.test.ts:12` builds
throwaway projects with `mkdtemp` + `writeFile`. Extend it, don't invent
a parallel mechanism.

1. **Fixture helper first.** Phase 1 starts by writing
   `packages/cli/test/workspace-fixture.ts`: `createWorkspaceFixture({
   kind, packages })` returning a temp root, so every test declares a
   layout in a few lines. Flavors needed across the phases: pnpm
   (`pnpm-workspace.yaml`), npm/yarn (`workspaces` field), Turborepo,
   Nx, a nested workspace, a package declaring React with no source
   files, a non-React package, and app-at-root-plus-libraries.
2. **The dogfood test is this repository.** This repo is itself a pnpm
   workspace whose root is the Next app and whose only other package
   (`packages/cli`) declares no React. So `shadscan` at this repo's root
   must discover exactly one application and produce the same score as
   today's single-package scan. Pin that as a test — it is the
   app-at-root invariant running against a real workspace, and it runs
   on every CI push for free.
3. **Windows is a first-class fixture axis.** Discovery walks
   directories and compares paths; PR #8 was exactly this class of bug
   (native separators fed to matchers). Workspace-relative package paths
   in reports must be posix-normalized, with a test asserting it. The
   packed-CLI CI matrix already runs `windows-latest`, so extend
   `cli:smoke` with a generated monorepo fixture — that makes Windows
   discovery break CI instead of a user's afternoon.
4. **Determinism**: every workspace fixture scanned twice, reports
   diffed byte-for-byte. The candidate ordering (`compareCodeUnits`) is
   load-bearing; the double-run is what enforces it.
5. **Pooling math has direct unit tests**, not just end-to-end ones:
   duplicate rule ids across packages score correctly; a category
   not-applicable in app A but applicable in app B pools to B's ratio;
   a library's findings provably absent from the pool.
6. **Human output snapshots**: workspace table, single package
   (unchanged), skipped packages, narrow terminal.
7. **Manual verification for the user**, at each phase boundary:
   - Phase 1: `shadscan --list-projects` at this repo's root and at a
     `create-turbo` scaffold — the list should match what you'd name.
   - Phase 2: `shadscan --json` at the fixture root; check
     `workspace.projects[]`, pooled `score`, and that
     `shadscan --project apps/web` matches today's output.
   - Phase 3: `shadscan` at the root; the table should read worst-first
     and the banner should say how many apps it covers.

## Verification (every phase)

- `pnpm cli:test`, `pnpm check`, `pnpm --filter ./packages/cli typecheck`,
  `pnpm test:api`, `pnpm test:web`, `pnpm test:e2e`, `pnpm build`.
- **No single-package drift**: audit this repo and three burn-in projects
  before and after each phase; single-package reports must be identical
  apart from `workspace: null` and `packageDir: null`.
- **Burn-in on real monorepos** — at minimum `shadcn-ui/ui` (itself a
  pnpm monorepo; scanning its *root* exercises the whole feature), `dub`,
  and a `create-turbo` scaffold. For each, confirm the package list
  matches what a human would name, every classification is defensible,
  and the pooled score is explicable from the per-package table.
- Time the runs. If a large monorepo takes minutes, that is a finding to
  report, not a detail to absorb.

## Open Questions / Risks

1. **Classification is a heuristic on a scored number.** Getting it wrong
   moves someone's score for a reason they did not choose. This is why
   `--list-projects` and visible per-package output are in the earliest
   phases rather than the last.
2. **The deeper fix is rule applicability.** The honest answer to
   "`foundation` is 0% for a library" is that those rules should be
   *not-applicable* for a library, not that libraries should be excluded
   from pooling. That is a much larger change touching every foundation
   rule, and it should follow this plan rather than block it — but if it
   lands later, the exclusion here becomes redundant and should be
   removed rather than left as a second mechanism.
3. **Schema 9 is a breaking-ish change** for anything strictly validating
   `schemaVersion: 8`. The Action reads `score`/`grade` and is fine.
   Call it out prominently in the changelog.
4. **Performance is unmeasured.** Sequential scanning of 25 packages,
   each building a render graph, could be minutes. The cap is a guess
   until Phase 2 produces numbers; treat it as tunable.
5. **Nested workspaces exist** (a workspace inside a workspace). Discovery
   must not double-count a package. Fixture required.
6. **The root package may itself be an app.** It must appear in the
   project list like any other and must not be scanned twice.
7. **This likely also fixes a reported failure.** The
   `UNSUPPORTED_PROJECT` message from a monorepo root is exactly what was
   reported against a real project earlier; that project was no longer on
   disk to confirm, so treat it as a strong hypothesis rather than a
   closed loop, and re-check it when this ships.
