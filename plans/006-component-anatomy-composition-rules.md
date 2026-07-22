# Plan 006: Manifest-driven component anatomy rules

> **Executor instructions**: This plan adds new CLI rules and a shared anatomy
> engine under `packages/cli`. Coordinate with any in-flight CLI work before
> starting. Execute phases in order — the engine and manifests land advisory
> (score-neutral) first, and nothing is promoted to scoring inside this plan.
> Run every verification command after each phase. Update `plans/README.md`
> when complete.
>
> **Drift check (run first)**:
> `ls packages/cli/src/rules/anatomy* packages/cli/src/anatomy* 2>/dev/null`
> If anatomy files already exist, someone started this plan; reconcile with
> that work instead of duplicating it.

## Status

- **State**: PLANNED
- **Priority**: P2
- **Effort**: L (engine M, pilot rules S each, burn-in ongoing)
- **Risk**: MEDIUM — new rule family; false positives erode trust, so
  everything ships advisory until proven
- **Depends on**: none (builds on existing AST helpers and rule registry)
- **Category**: feature/ruleset
- **Planned at**: 2026-07-22

## Why This Matters

shadcn components are composition contracts: an `Alert` is built from
`AlertTitle`, `AlertDescription`, and optional icon and action parts;
`SelectItem` belongs inside `SelectGroup`; `InputGroup` accepts
`InputGroupInput`, not a raw `Input`. Agents are taught these contracts by
authoring guidance, but shadscan only enforces one of them today
(`button-icons-have-data-icon`). Encoding the structural contracts as audit
rules closes the loop: the same convention an agent is taught at authoring
time is enforced deterministically at audit time, cited in the `--prompt`
handoff with the expected anatomy as the acceptance criterion.

The differentiator is that shadcn vendors component source into the user's
project. Anatomy can therefore be derived from the project's own
`components/ui/*` files rather than hardcoded upstream shapes, which keeps the
rules correct across shadcn versions and user customization.

## Current State

- `packages/cli/src/rules/button-icons-have-data-icon.ts` is the proof of
  concept for this rule family: import-provenance matching
  (`SHADCN_BUTTON_MODULE_PATTERN`), JSX-tree walking via `../ast` helpers, and
  `advisory`/`fail`/`pass`/`notApplicable` results. It is currently a
  hand-rolled single-component rule.
- 54 rule modules register through `default-rules.ts`; results carry
  `confidence`, `severity`, and `impactsScore`.
- `docs:rules` generates the rule catalog consumed by `docs/rules.md` and the
  website's `/rules` page, so new rules self-document.
- No shared representation exists for "component X is composed of parts Y"
  even though several existing rules (dialog names, form labels) partially
  reason about composition.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused tests | `pnpm --filter ./packages/cli exec vitest run test/anatomy-*.test.ts` | exit 0 |
| Full CLI tests | `pnpm cli:test` | all tests pass |
| Typecheck | `pnpm --filter ./packages/cli typecheck` | exit 0 |
| Lint/format | `pnpm check` | exit 0 |
| Build | `pnpm cli:build` | exit 0 |
| Rule docs | `pnpm docs:rules && pnpm docs:check` | catalog regenerated, exit 0 |
| Self-audit | `pnpm audit:self` | score unchanged (advisories are score-neutral) |

## Scope

### In scope

1. A declarative anatomy manifest format and one generic evaluation engine.
2. Project-derived part discovery from the user's own `components/ui` source.
3. Three pilot rules built on the engine (all advisory in this plan):
   - `items-belong-to-groups` — `SelectItem`/`DropdownMenuItem`/`CommandItem`
     must sit under their matching `*Group` (and `CommandGroup` under
     `CommandList`), covering the three components with one manifest each.
   - `input-group-composition` — `InputGroup` children must be
     `InputGroupInput`/`InputGroupTextarea`/`InputGroupAddon`
     (buttons only inside an addon); raw `Input`/`Textarea`/`Button` children
     fail the contract.
   - `alert-anatomy` — `Alert` contains at most one leading icon, an
     `AlertTitle` (required), optional `AlertDescription` and `AlertAction`;
     unknown children are reported only when part discovery proves they are
     not project-defined extensions.
4. Rule catalog entries that render the expected anatomy tree per rule.
5. Fixture-based tests, including customized-component fixtures that must NOT
   produce findings.

### Out of scope (this plan)

- Promoting any anatomy rule to `impactsScore: true` (follow-up plan after
  burn-in against real repositories).
- Judgment-call conventions with no structural definition ("use existing
  components", "className for layout not styling", "callouts use Alert").
- `ToggleGroup`-for-option-sets heuristics (needs its own false-positive
  study).
- Hosted-API or web-scanner changes (rules flow through automatically).

## Phase 1 — Anatomy engine and manifest format

New module `packages/cli/src/anatomy.ts` (or `src/anatomy/` if it grows):

```ts
interface AnatomyPart {
  name: string;              // "AlertTitle"
  required?: boolean;        // default false
  max?: number;              // e.g. icon max 1
  kind?: "component" | "icon"; // icon uses the shared icon-name heuristics
}

interface ComponentAnatomy {
  component: string;         // "Alert"
  modulePattern: RegExp;     // /(?:^|\/)ui\/(?:components\/)?alert$/
  parts: AnatomyPart[];      // allowed direct-content parts
  container?: {              // for item-in-group contracts
    child: string;           // "SelectItem"
    parent: string;          // "SelectGroup"
  };
  allowUnknownChildren: "never" | "when-project-defined" | "always";
}
```

Engine responsibilities, reusing existing `../ast` helpers:

1. Resolve provenance: the rule only evaluates JSX elements whose tag imports
   from the project's shadcn ui path (same approach as
   `SHADCN_BUTTON_MODULE_PATTERN`), including alias/namespace imports.
2. Part discovery: parse the project's own `components/ui/<component>.tsx`
   exports so a user-added part (e.g. a custom `AlertBadge` exported from
   `ui/alert`) counts as project-defined and never fails
   `when-project-defined` manifests.
3. Uncertainty: spreads (`{...props}`), `{children}` projection, dynamic
   expressions, and fragments mark the surface unknown → `notApplicable` or
   evidence-limited advisory, never a fail. Mirror the established
   render-graph uncertainty discipline.
4. Evidence: every finding cites file, line, the offending child, and the
   expected anatomy rendered as an indented tree in the remediation text.

Deliverables: engine + unit tests over synthetic SourceFiles (no fixtures yet).

## Phase 2 — Pilot manifests and rules

- One rule module per pilot rule, each thin: manifest(s) + engine call +
  result shaping, registered in `default-rules.ts`.
- All three ship `severity: "warning"`, `confidence: "medium"` (engine is new),
  `impactsScore: false`.
- Fixtures under `packages/cli/test/`: for each rule a passing fixture, a
  failing fixture, a customized-component fixture (user extended the ui file —
  must pass), and an uncertainty fixture (spread children — must not fail).
- `pnpm docs:rules` regenerates the catalog; verify the `/rules` page renders
  the three new entries with their anatomy trees.

## Phase 3 — Burn-in and promotion criteria (definition only)

Define, in the rule catalog entry for each pilot rule, the promotion bar a
follow-up plan must meet before flipping `impactsScore`:

- Zero confirmed false positives across the dogfood repo plus at least five
  external public shadcn repositories scanned during burn-in.
- `items-belong-to-groups` and `input-group-composition` are candidates for
  `confidence: "high"` + scoring; `alert-anatomy` stays advisory until the
  part-discovery path has proven itself against customized projects.

## Verification

1. `pnpm cli:test`, `pnpm --filter ./packages/cli typecheck`, `pnpm check`,
   `pnpm cli:build`, `pnpm docs:check` all pass.
2. `pnpm audit:self` score is unchanged (advisories only).
3. Scan two external fixtures manually: one repository with stock shadcn
   components (expect findings only on genuine violations) and one with
   customized ui components (expect zero anatomy findings).
4. The rule catalog and `/rules` page show the three rules with anatomy trees.

## Hard-won context for the executor

- Import provenance is what keeps this honest: a lookalike `Alert` from a
  different design system must never be evaluated. Reuse the module-pattern
  approach from `button-icons-have-data-icon.ts` rather than tag-name matching.
- The ruleset version (`BUNDLED_RULESET_VERSION`) must advance with the new
  rules, and the changelog entry for the release that ships them should call
  them out as advisory-only.
- Do not copy authoring-guidance prose into rule descriptions; write original
  descriptions that state the structural contract being checked.
- Keep per-rule work items in the agent handoff scoped to one component
  instance per finding so agents fix call sites, not the ui source file.
