# Plan 017: A /stats page for shadscan's npm usage

> **Executor instructions**: This plan adds a public `/stats` page in the
> spirit of nuqs.dev/stats — npm downloads, version adoption, and GitHub
> stars — charted with Bklit components installed through the shadcn
> registry. It is a **site-only** change: no CLI code, no ruleset bump, no
> schema change, no npm release. Before writing any chart code, load the
> `dataviz` skill; before installing Bklit, remember the shadcn CLI is in
> RC (`shadcn@rc`, per the repo skill override). Keep the pre-commit
> self-audit at 100 and update `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `ls app/stats 2>/dev/null; grep -rn "api.npmjs.org" lib/`
> If the page or a downloads fetcher already exists, reconcile against
> what shipped.

## Status

- **State**: PLANNED
- **Priority**: P2 — marketing/credibility surface, not product behavior.
- **Effort**: M
- **Risk**: LOW-MEDIUM. The engine is untouched; the risks are the two
  usual site ones — an external API taking down a page (the 0.6.1
  changelog-frontmatter incident took down the *home* page), and a chart
  page that fails shadscan's own audit.
- **Depends on**: none
- **Category**: site/feature
- **Planned at**: 2026-08-04

## Current State (verified 2026-08-04)

**What nuqs.dev/stats shows**, for reference: npm downloads over 90/30-day
windows with trend deltas, per-package variant comparison, a stargazer
count, and a Repobeats activity embed.

**What Bklit is** (verified against its docs, not assumed): a
data-visualization component library distributed through the **shadcn
registry** — `pnpm dlx shadcn@latest add @bklit/area-chart`, registry URL
`https://ui.bklit.com/r/{name}.json`. Area, bar, line, pie/ring, heatmap
and a dozen more chart types. Its rendering dependency is **not
documented** on the installation page; the executor must inspect what
`@bklit/area-chart` actually pulls into `package.json` before committing
to it (Phase 2, step 3). Some charts auto-include `@bklit/shimmering-text`.

**What npm actually has for `@shadscan/cli`** (probed live):

| Endpoint | Works | Sample |
|---|---|---|
| `api.npmjs.org/downloads/range/{from}:{to}/@shadscan/cli` | yes | 14 daily points, 547–2,558/day |
| `api.npmjs.org/downloads/point/last-week/@shadscan/cli` | yes | 9,631 |
| `api.npmjs.org/versions/@shadscan%2Fcli/last-week` | yes (scope must be `%2F`-encoded) | 0.7.0: 3,095 · 0.1.1: 2,970 · 0.8.0: 2,302 |
| `registry.npmjs.org/@shadscan/cli` | yes | versions + publish timestamps in `time` |

**Existing conventions to reuse**: `lib/public-github-repository.ts`
already fetches the repo (stars included) with
`{ revalidate: REVALIDATE_SECONDS }` and defensive response validation;
`app/contributors/page.tsx` is the model for an external-API page
(`export const revalidate = 3600`, its own `opengraph-image.tsx`); e2e
mocks external hosts through `next.onFetch`
(`test/e2e/github-fixtures.ts`). `app/**/*` and `lib/**/*.ts` are already
in `SCANNER_TRACE_EXCLUDES`, so no build-trace change is needed.

## Scope decision (read this first)

### The data is two weeks old — design for that, don't fake around it

`@shadscan/cli` first published 2026-07-22. nuqs's "last 90 days vs last
30 days" framing would render as two nearly identical numbers here and
read as padding. The page frames everything as **"since first release"**
and lets the richer windows appear naturally as history accrues: the
range fetcher takes `firstPublishDate:today` (clamped to npm's 18-month
window maximum for the future), and the 30/90-day comparison tiles are
added by data, not by code change, once the history exists.

Two more honesty constraints, stated on the page itself in small print,
because this site's brand is not inventing certainty:

- npm's download counts include CI and bots and lag about a day; the page
  says "downloads", never "users".
- **Per-version data is a last-week snapshot only.** npm has no
  per-version history endpoint. The version-adoption chart is labelled
  "last 7 days", not presented as a trend.

### What gets charted

Three visuals, no more — every one answerable from a real endpoint:

1. **Daily downloads since first release** — Bklit area chart, with
   release markers derived from the registry `time` map so spikes are
   explicable ("0.7.0 shipped here").
2. **Version adoption, last 7 days** — Bklit bar chart from the
   per-version endpoint, top 6 versions plus "other", prereleases
   grouped.
3. **Stat tiles** — total downloads since release (summed from the range
   data), last-week downloads, latest version, versions published, and
   GitHub stars (reusing the existing repository fetcher — no new GitHub
   call).

**Out of scope**: Repobeats (needs an owner-installed GitHub app — listed
as an owner-held option, not a phase), dependents/stars-over-time (no
free endpoint worth the scraping), and any client-side fetching — all
data arrives via server components so the page costs visitors nothing.

### Persistence is deliberately deferred

The repo has Drizzle and a database, and a weekly cron snapshotting the
per-version endpoint would eventually turn the snapshot into a real
adoption-over-time chart. That is a genuinely good follow-up — and out of
scope, because it adds a write path and a migration for a chart the page
does not need on day one. Recorded as a follow-up, not smuggled in.

## Phase 1 — Data layer

1. `lib/npm-stats.ts` with three fetchers modelled line-for-line on
   `lib/public-github-repository.ts` conventions: `REVALIDATE_SECONDS`
   caching, zod-or-manual response validation that rejects surprising
   shapes rather than rendering them.
2. First-publish date comes from the registry `time` map (`created`),
   never hardcoded.
3. **Degrade, never throw.** Every fetcher returns `null` on failure, and
   the page renders tiles/charts for whatever arrived, with a quiet
   "stats are temporarily unavailable" for whatever did not. An npm
   outage must not error-boundary the page — this is the 0.6.1 lesson
   applied in advance.
4. Unit tests in the web test suite: response validation, the `%2F`
   encoding of the scoped name, range clamping, and the null-on-failure
   contract.

## Phase 2 — Bklit installation

1. Add `"@bklit": "https://ui.bklit.com/r/{name}.json"` to
   `components.json` registries.
2. `pnpm dlx shadcn@rc add @bklit/area-chart @bklit/bar-chart` — RC CLI,
   per the repo override.
3. **Review what landed before building on it** (shadcn skill steps 6–7):
   what runtime dependency the charts brought (Recharts? their own
   renderer?), whether imports match this repo's aliases, and whether the
   components respect the site's CSS variables in both themes. If the
   pulled dependency is unexpectedly heavy or the components fight the
   theme, stop and report before sinking the page onto them.
4. Charts are client components; the page stays a server component that
   passes plain serializable props down.

## Phase 3 — Page assembly

1. `app/stats/page.tsx` (`export const revalidate = 3600`) with the three
   visuals and the honesty captions; `loading.tsx` skeleton;
   `opengraph-image.tsx` following the contributors pattern; metadata
   (title, description) like every other page.
2. Load the `dataviz` skill before writing the chart composition, and keep
   both themes correct — the mode switcher is a first-class feature here.
3. Release markers: vertical annotations at each stable release date from
   the registry `time` map, prereleases omitted to avoid clutter.
4. Add "Stats" to `NAV_LINKS` in `site-header.tsx` and to the command
   menu's page list. Check the header still fits at 320px — the e2e
   viewport matrix will catch it if not.
5. Numbers formatted with the same `Intl.NumberFormat` compact style the
   stars badge uses.

## Phase 4 — Verification and PR

1. e2e spec mocking `api.npmjs.org` and `registry.npmjs.org` through
   `next.onFetch` (extend the `github-fixtures.ts` pattern): page renders
   with data, page renders the degraded state when the mock returns 500,
   and the viewport matrix passes.
2. Self-audit: the new page must keep the repo at 100/100 — charts are
   exactly the kind of surface that trips accessibility and
   responsive rules, which is also why the dataviz skill loads first.
3. Full site gates (`check`, `typecheck`, `test:web`, `test:e2e`,
   `build`). No CLI gates needed; nothing under `packages/cli` changes.
4. PR with screenshots of both themes. No `CHANGELOG.md` entry — that
   file records CLI releases, and this matches the brand-assets-menu
   precedent (#22).

## Open Questions / Risks

1. **Bklit is young and its renderer is undocumented.** The Phase 2
   review gate exists so we can walk away cheaply if it pulls something
   unreasonable. Fallback if it disappoints: the shadcn `chart` component
   (Recharts) already ships in this ecosystem and the data layer is
   chart-library-agnostic.
2. **npm occasionally returns zeros for recent days** while its pipeline
   catches up. Consider dropping the trailing day from the area chart —
   decide when the real data is visible in review.
3. **A young package's chart is small.** Fourteen data points is an
   honest, slightly sparse chart. It fills in on its own; resist the urge
   to pad it with synthetic smoothing.
4. **Follow-up, not now**: weekly per-version snapshots via cron + Drizzle
   to build true adoption-over-time; 30/90-day comparison tiles once ~90
   days of history exist; Repobeats embed (owner-held — requires
   installing their GitHub app).
