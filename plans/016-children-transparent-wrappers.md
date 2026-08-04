# Plan 016: See through children-transparent wrappers

> **Executor instructions**: This plan raises render-graph surface
> completeness by expanding through components that provably render their
> children, instead of stopping at them. It changes **evidence quality**,
> not rules: no rule logic, no ruleset bump, no schema change. It will
> change scores wherever better evidence lets an existing rule reach a
> different verdict, so the burn-in in Phase 3 is the load-bearing gate,
> not a formality. Add an Unreleased changelog entry, and update
> `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `grep -rn "childrenProjection\|opaque children projection" packages/cli/src/component-render-graph/`
> If pass-through already exists, reconcile against what shipped.

## Status

- **State**: PLANNED
- **Priority**: P1 — this caps evidence quality for every adapter at once,
  which is worth more than any single new adapter now that all six
  official shadcn templates are covered.
- **Effort**: L
- **Risk**: MEDIUM-HIGH. Expanding further means rules see **more**
  instances, so verdicts can move in both directions: a rule that passed
  on thin evidence may now fail, and vice versa. Unlike plan 013 this is
  not a one-directional loosening, so both directions need reading during
  burn-in.
- **Depends on**: none
- **Category**: engine/evidence
- **Planned at**: 2026-08-02

## Current State (measured 2026-08-02, at `499f698`)

Probed three real codebases by building the graph directly and grouping
surface boundary reasons.

| Project | Surfaces | Partial | Dominant boundary reasons |
|---|---|---|---|
| this repository | 10 | **10 (100%)** | 10× opaque children projection |
| `satnaing/shadcn-admin` | 1 | 1 (100%) | render-root detection, unrelated |
| `shadcn/taxonomy` | 18 | 14 (78%) | 28× component could not be resolved; 14× opaque children projection; 14× className forwarding unproven; 6× `map()` multiplicity |

Naming the specific blockers is what makes the design:

- **This repository**: every surface is partial, and the single cause is
  `ThemeContext.Provider` — a **locally created React context**
  (`components/theme-provider.tsx:29`, rendered at line 158).
- **`taxonomy`**: opaque projection is caused by `Link` — **`next/link`**,
  an external package component — and the unresolvable component is
  `Icons`, a **compound/namespace object** (`Icons.logo`).

### Three findings that change the plan

1. **"Context providers" was too narrow.** The blocked wrapper is a local
   context provider in one repository and an external package component in
   the other. A fix that only handles `X.Provider` would fix this
   repository and do nothing for `taxonomy`.
2. **This is not the only cause of partial surfaces, and in the larger
   codebase it is not even the biggest.** In `taxonomy`, "component could
   not be resolved" outnumbers opaque projection two to one, and
   className-forwarding accounts for as many again. Fixing projection
   raises completeness; it does not make surfaces complete.
3. **`shadcn-admin`'s partiality is unrelated** — its Vite render root is
   not recognized. Nothing in this plan will improve it, and the plan must
   not claim otherwise.

## Scope decision (read this first)

### Two wrapper kinds, two levels of certainty

The graph already models children projection (`childrenProjection`,
`children-projection` template items in `expansion.ts`); it stops only
because the wrapper never resolves. So the work is deciding **when it is
provable that a component renders its children**, and there are exactly
two answers worth acting on:

**A. Local context providers — provable.** For `X.Provider` where `X`
resolves to a local `createContext(...)` call, React guarantees the
children render. This is not a heuristic; it is the semantics of the API.
It needs `resolveElementTarget` (`symbol-resolution.ts:511`) to stop
rejecting dotted tags whose root is a local binding, and a check that the
binding's initializer is a `createContext` call.

**B. Allowlisted external wrappers — conventional.** `next/link`'s `Link`
cannot be read: it lives in `node_modules`, outside the scan boundary. But
its contract is stable and public. A small curated table of
package-and-export pairs that render their children — `next/link` `Link`,
`next-themes` `ThemeProvider`, `@tanstack/react-query`
`QueryClientProvider`, `next-auth/react` `SessionProvider`, React's own
`Suspense`, `StrictMode`, `Fragment`, `Profiler` — covers the wrappers
that actually appear in shadcn apps.

**Nothing else changes.** An unknown external component keeps its opaque
boundary. This matters: `next/head`'s `Head` accepts children and renders
them *nowhere in the visible tree*, and a blanket "external components
render their children" rule would invent UI that does not exist. Every
allowlist entry must be justified in a comment naming the contract it
relies on, and the table must be one module-level constant so adding to it
is a reviewable data change.

### Compound components are a separate, smaller fix

`Icons.logo` and `EmptyPlaceholder.Title` fail for the same *mechanical*
reason as `ThemeContext.Provider` — `resolveElementTarget` only accepts a
dotted tag when the root is an imported **namespace** binding. Resolving
dotted tags against local objects and named imports fixes compound
components too, which is why it lands in the same phase as (A). But it is
a distinct user-visible win and should be described as such rather than
folded into "provider support".

### What this plan does not do

- It does not touch the className-forwarding or `map()`-multiplicity
  boundaries, which are comparable in size in `taxonomy`. Each deserves
  its own plan.
- It does not attempt Vite render-root detection (`shadcn-admin`).
- It does not add a rule or change scoring intentionally. Any score change
  is a consequence of better evidence and must be explained one by one.

## Phase 1 — Resolve dotted tags against local bindings

No projection changes yet, so surfaces gain resolved instances without
changing what expands through them. This isolates the resolver change.

1. In `resolveElementTarget`, when a tag has a member part and the root is
   **not** an imported namespace, try the local binding before giving up:
   resolve `X` in the file's scope, and if it is an object literal or a
   variable whose members are components, resolve `X.Member` to that
   component.
2. Mark the result `resolved` only when exactly one definition is found —
   keep the existing exactly-one-or-bail discipline that makes graph
   results verified rather than guessed.
3. Leave the boundary reason wording intact for genuinely unresolvable
   dotted tags, and add a distinct reason for "root resolved but member
   not found" so the two failures are told apart in reports.

**Tests**: compound component via `Object.assign`, via
`Component.Sub = Sub`, via an object literal of components, an ambiguous
root (must stay unresolved), and a dotted tag on an external import (must
stay `external`).

## Phase 2 — Expand through provable and allowlisted wrappers

1. Add `component-render-graph/children-transparent.ts` exporting a
   predicate over a resolved-or-external tag: local context providers
   (`X.Provider` whose `X` initializer is a `createContext` call), plus the
   curated external table described above.
2. When the predicate holds, project the wrapper's children into the
   surface rather than recording an opaque-projection boundary. The
   wrapper itself still appears as an instance — it is really rendered —
   but it stops being a wall.
3. Record a *reason for transparency* on the instance
   (`"local context provider"` / `"known children-transparent export from
   next/link"`), so a reader can audit why the graph walked through it.
   Evidence people cannot audit is the failure mode this whole engine
   exists to avoid.
4. Respect the existing depth and node budgets. Seeing through providers
   means deeper trees; confirm `limits.maxDepth` and the surface-plan
   budget still terminate, and that hitting a budget records a boundary
   rather than silently truncating.

**Tests**: local provider wrapping a nav (children now visible), an
allowlisted external wrapper, a non-allowlisted external wrapper (still
opaque), `next/head`-shaped wrapper (must stay opaque), a provider nested
three deep, and a cycle guard.

## Phase 3 — Burn-in, and reading score movement in both directions

This is the gate the plan lives or dies on.

1. Re-run the measurement probe from *Current State* on all three
   codebases plus this repository, and record the before/after
   completeness table in the PR.
2. Audit at least four public projects before and after. For **every**
   rule whose status changes, in **either** direction, inspect by hand and
   record whether the new verdict is better-founded. A rule flipping
   pass→fail is the expected shape here — more visible UI means more
   surface for an accessibility or responsive rule to judge — and that is
   a *correct* outcome, not a regression, provided the newly-seen UI is
   real.
3. Explicitly confirm the counter-case: a project with no
   children-transparent wrappers must produce a byte-identical report.
4. **Determinism**: every fixture scanned twice, reports diffed.
5. Time the runs. Deeper expansion costs; if a large project slows
   materially, report the number rather than absorbing it.

## Phase 4 — Report the improvement honestly

1. Changelog entry that says what got better and what did not: completeness
   rises, some verdicts change because rules can finally see the UI, and
   the other three causes of partial surfaces are untouched.
2. If scores move on real projects, say so in the release notes with the
   reason. A score moving without a code change needs an explanation or it
   reads as instability — the same standard applied in 0.6.0.

## Verification (every phase)

- `pnpm cli:test`, `pnpm check`, `pnpm --filter ./packages/cli typecheck`,
  `pnpm test:api`, `pnpm test:web`, `pnpm test:e2e`, `pnpm build`.
- Graph fixtures under `packages/cli/test/` will need updating where
  expansion legitimately goes deeper; each updated snapshot must be read,
  not regenerated blindly. A snapshot diff nobody read is how invented UI
  would slip in.
- GitHub Actions is currently blocked on billing; if it is still blocked,
  note in the PR that the Windows matrix did not run.

## Open Questions / Risks

1. **Bidirectional score movement** is the headline risk, and it is
   qualitatively different from plan 013's one-directional loosening. Budget
   real time for Phase 3.
2. **The allowlist is a maintenance surface.** It encodes third-party
   contracts that could change across major versions. Keep it small,
   comment each entry with the contract relied on, and prefer omitting a
   package over guessing at it.
3. **`Suspense` is transparent but conditional** — it renders `fallback`
   instead of children while pending. Both branches are real UI; decide
   deliberately whether to expand children, fallback, or both, and record
   the choice as a guard rather than silently picking children.
4. **Deeper trees cost time and nodes.** The budgets exist; this plan must
   prove they still hold rather than assume it.
5. **This will not make surfaces complete.** In `taxonomy` the larger
   cause is unresolvable components and className forwarding. Say so in
   the changelog so "complete" is not over-promised.
