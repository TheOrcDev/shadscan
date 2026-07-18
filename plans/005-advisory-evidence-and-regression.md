# Plan 005: Tighten advisory evidence and lock the OrcDev regression

> **Executor instructions**: Execute this only after Plans 001-004. Run every
> verification command and compare the final external scan with the expected
> truth table. Update `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `git diff --stat 07a9eae..HEAD -- packages/cli/src/rules/destructive-actions-confirmed.ts packages/cli/src/rules/mobile-overflow-absent.ts packages/cli/test/advisory-rules.test.ts`
> Drift from completed Plans 001-004 is expected; stop only if the two advisory
> rule implementations or their tests changed incompatibly.

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: M
- **Risk**: LOW - both rules are score-neutral, but evidence quality affects agent work
- **Depends on**: Plans 001, 002, 003, and 004
- **Category**: bug/tests
- **Planned at**: commit `07a9eae`, 2026-07-19

## Why This Matters

Two OrcDev advisories identify syntax that is unrelated to the risk they claim:
a visual `Badge variant="destructive"` is called a destructive action, and an
image `sizes` hint containing `100vw` is called a layout overflow risk. These do
not alter the score, but they generate agent actionables and erode trust. After
tightening them, a combined OrcDev-shaped regression fixture should preserve
the complete truth table across all five detector fixes.

## Current State

- `destructive-actions-confirmed.ts:5-8` searches entire UI files for destructive
  words or any `variant="destructive"`, without checking whether the JSX node is
  interactive.
- OrcDev's match at `components/equipment.tsx:144-149` is a `Badge` reading
  `Coming soon`; it has no click handler or destructive behavior.
- The rule currently accepts a confirmation primitive anywhere in any UI file,
  even if unrelated to the destructive action.
- `mobile-overflow-absent.ts:9-10` searches raw file text for `100vw`.
- OrcDev's match is `Image sizes="...100vw"` at
  `components/project-grid.tsx:265`. The image uses `fill` inside a constrained
  aspect-ratio container. Runtime checks at 320px show no document overflow.
- Plans 001-004 establish corrected outcomes that need one integrated fixture.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused tests | `pnpm --filter shadscan exec vitest run test/advisory-rules.test.ts test/orcdev-regression.test.ts` | exit 0 |
| Full CLI tests | `pnpm cli:test` | all tests pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint/format check | `pnpm check` | exit 0 |
| Build | `pnpm cli:build` | exit 0 |
| Docs | `pnpm docs:check` | exit 0 |
| Release check | `pnpm cli:release:check` | exit 0 |
| Self-audit | `pnpm audit:self` | score 100 and exit 0 |

## Scope

**In scope**:

- `packages/cli/src/rules/destructive-actions-confirmed.ts`
- `packages/cli/src/rules/mobile-overflow-absent.ts`
- `packages/cli/test/advisory-rules.test.ts`
- `packages/cli/test/orcdev-regression.test.ts` (new)
- `packages/cli/src/scan.ts`
- `docs/rules.md`
- `CHANGELOG.md`

**Out of scope**:

- Turning either advisory into a score-affecting rule
- Runtime browser automation inside Shadscan
- Suppressing all `destructive` variants
- Suppressing real `w-screen`, fixed-width, or CSS `100vw` layout risks
- Resolving the score-neutral dynamic alt/title/contrast/target advisories
- OrcDev source changes

## Git Workflow

- Branch: `codex/005-advisory-evidence-regression`
- Commit example: `fix: tighten browser advisory evidence`.
- Do not push unless instructed.

## Steps

### Step 1: Add destructive-action false-positive fixtures

Add tests for:

1. `<Badge variant="destructive">Coming soon</Badge>` - not applicable.
2. `<Button variant="destructive">Delete account</Button>` - advisory without
   safeguard.
3. The same button in a correlated AlertDialog/confirmation flow - pass.
4. A delete button in one component and unrelated AlertDialog in another file -
   must remain advisory.
5. A destructive handler/action identifier on an interactive element without a
   visual destructive variant - advisory.

### Step 2: Detect destructive actions structurally

Use the TypeScript JSX AST. A candidate must be an actual action surface:

- native button or submit control;
- known button/menu action component;
- element with button role or an action handler;
- form action/handler with destructive naming evidence.

Only treat `variant="destructive"` as evidence on an interactive candidate.
Correlate confirmation/undo evidence within the same owned component or action
flow; project-global confirmation presence is insufficient. Keep uncertain
custom controls advisory.

**Verify**: all five destructive fixtures pass their expected assertions.

### Step 3: Add attribute-context overflow fixtures

Add tests for:

1. `<Image fill sizes="(min-width: 640px) 50vw, 100vw" />` - no specific
   overflow-risk evidence.
2. `<main className="w-screen">` - overflow-risk advisory.
3. `<div style={{ minWidth: "900px" }}>` - overflow-risk advisory.
4. CSS `.wide { width: 100vw; }` - overflow-risk advisory.
5. A long prose string containing `100vw` outside class/style/CSS - ignored.

### Step 4: Parse only layout-bearing contexts

For JSX/TSX, inspect static `className` values and style-object width/minWidth
properties. Do not scan `sizes`, `srcSet`, alt text, prose, or arbitrary string
literals. For stylesheet files, inspect CSS width/min-width declarations.

Keep the generic score-neutral advisory when no obvious static risk is found;
only the evidence classification changes.

**Verify**: real width fixtures retain the `overflow-prone` message, while the
Image sizes fixture receives only generic browser-verification wording.

### Step 5: Add the combined OrcDev-pattern regression fixture

Create `packages/cli/test/orcdev-regression.test.ts` using the existing
temporary fixture helpers. Include minimal source for these exact patterns:

- umbrella Radix toast through local Toaster/toast files;
- complete root metadata and child title/openGraph metadata;
- static generated blog plus force-dynamic videos route;
- custom state-controlled responsive nav with mutually exclusive desktop nav;
- generated Input primitive plus newsletter Input call without FormLabel;
- non-interactive destructive Badge;
- Image `sizes` containing `100vw`.

Assert the corrected truth table:

- toast present/mounted: pass;
- metadata complete: pass;
- mobile nav and nav landmark naming: pass;
- loading boundary: fail at videos;
- forms labels: fail at newsletter usage;
- destructive action: not-applicable;
- mobile overflow: advisory without `overflow-prone` evidence.

Do not copy the entire external app into the repository. The fixture should be
small, deterministic, and free of network/env dependencies.

### Step 6: Update contract and run external validation

Bump the ruleset revision, regenerate docs, and add a changelog entry. Run the
complete command table, then scan OrcDev with the built CLI.

Expected external outcome:

- Overall score is `75/100` if OrcDev has not changed.
- The five false score deductions pass:
  `toast-provider-present`, `toast-provider-mounted`,
  `metadata-title-description-complete`, `mobile-nav-present`, and
  `nav-landmarks-have-names`.
- `route-loading-boundary-present` fails at videos.
- `forms-have-labels` fails at newsletter usage.
- Destructive Badge evidence is gone.
- `sizes="...100vw"` is not reported as overflow-prone.

## Test Plan

- Keep each focused rule test small and diagnostic.
- Use the integrated fixture only for cross-rule regression and evidence paths.
- Assert finding IDs, statuses, file paths, and key evidence wording.
- Preserve schema version and agent-handoff output shape.

## Done Criteria

- [x] Badge variant no longer creates a destructive-action advisory.
- [x] Real destructive buttons remain advisory without safeguards.
- [x] Image `sizes` no longer creates overflow-risk evidence.
- [x] Real layout width risks remain advisory.
- [x] Combined OrcDev regression test passes.
- [x] External OrcDev scan matches the expected corrected truth table and score.
- [x] Full tests, typecheck, check, build, docs, release check, and self-audit pass.
- [x] Ruleset/changelog updated and OrcDev untouched.

## STOP Conditions

- Plans 001-004 are incomplete or their expected statuses do not pass in an
  integrated fixture.
- The advisory fix requires executing application code.
- Structural destructive detection cannot distinguish Badge from Button.
- Overflow detection must return to raw whole-file regex scanning.
- OrcDev changed after commit `50ef95b`; report drift and update expected
  evidence before asserting a score.

## Maintenance Notes

The integrated fixture is a regression contract, not a snapshot of OrcDev.
Keep only the minimal source patterns that previously fooled Shadscan. Update
the truth table when a deliberate rule-policy decision changes, not merely to
make a failing test green.
