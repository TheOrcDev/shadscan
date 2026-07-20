# Plan 004: Report form-label failures at rendered call sites

> **Executor instructions**: Follow the plan exactly, run every verification,
> and update `plans/README.md` when complete. Stop rather than suppressing real
> unlabeled fields.
>
> **Drift check (run first)**:
> `git diff --stat 07a9eae..HEAD -- packages/cli/src/rules/accessibility.ts packages/cli/src/rules/custom-controls-have-labels.ts packages/cli/test/accessibility-rules.test.ts`

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: M
- **Risk**: MED - component wrappers can hide or synthesize label wiring
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `07a9eae`, 2026-07-19

## Why This Matters

OrcDev genuinely has two unlabeled newsletter inputs, but shadscan reports the
generic `<input {...props}>` inside `components/ui/input.tsx`. An executor
following the handoff would incorrectly add a label to a reusable primitive
instead of fixing its call sites. The rule must ignore pass-through primitive
definitions and evaluate common Input/Textarea usage, including shadcn
`FormItem` and `FormLabel` composition.

## Current State

- `accessibility.ts:367-455` checks only native `input`, `select`, and
  `textarea` tags in each file independently.
- It does not exclude generated `components/ui` primitives.
- `custom-controls-have-labels.ts` intentionally excludes generated UI files
  but does not include `Input` or `Textarea` in its control set.
- OrcDev's primitive at `components/ui/input.tsx:10` forwards all props and is
  not independently labelable.
- The real failures are:
  - `components/sections/newsletter/newsletter.tsx:90`
  - `components/sections/newsletter/newsletter.tsx:102`
- Both fields are inside `FormItem`/`FormControl` but have no `FormLabel`,
  `aria-label`, or `aria-labelledby`. Browser inspection confirms both have no
  accessible name.
- A valid shadcn form often uses sibling `FormLabel` and `FormControl`; the
  runtime context generates matching `htmlFor` and `id` values.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused tests | `pnpm --filter ./packages/cli exec vitest run test/accessibility-rules.test.ts` | exit 0 |
| Full CLI tests | `pnpm cli:test` | all tests pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint/format check | `pnpm check` | exit 0 |
| Build | `pnpm cli:build` | exit 0 |
| Docs | `pnpm docs:check` | exit 0 |
| Self-audit | `pnpm audit:self` | score 100 and exit 0 |

## Scope

**In scope**:

- `packages/cli/src/rules/accessibility.ts`
- `packages/cli/src/rules/custom-controls-have-labels.ts` only if needed to
  prevent duplicate findings
- `packages/cli/test/accessibility-rules.test.ts`
- Optional focused fixture helper under `packages/cli/test`
- `packages/cli/src/scan.ts`
- `docs/rules.md`
- `CHANGELOG.md`

**Out of scope**:

- General React component rendering
- Assuming placeholder text is an accessible label
- Changing OrcDev forms
- Moving this check to browser automation
- Silencing all native controls under any file named `input.tsx`

## Git Workflow

- Branch: `codex/004-form-label-call-sites`
- Commit example: `fix: report unlabeled fields at call sites`.
- Do not push unless instructed.

## Steps

### Step 1: Add primitive-versus-call-site fixtures

Create tests with a generated-style `components/ui/input.tsx` wrapper and app
usage files:

1. `<Input aria-label="Email" />` - pass.
2. `<FormItem><FormLabel>Email</FormLabel><FormControl><Input /></FormControl></FormItem>`
   - pass.
3. OrcDev shape with `<FormItem><FormControl><Input placeholder="Email" /></FormControl></FormItem>`
   - fail, with evidence at the usage file and line.
4. A direct unlabeled native `<input>` outside generated UI - fail as today.
5. A generated primitive with no call sites - not a failure by itself.

Before implementation, fixture 3 should fail for the wrong file and fixture 5
should fail incorrectly.

### Step 2: Classify pass-through UI primitives

Exclude native control implementation nodes under the configured/generated UI
component directory when they are pass-through component definitions. Reuse
the project's established generated UI path convention. Do not exclude app
usage files or arbitrary source directories.

Prefer structural evidence such as an exported wrapper and prop spread over a
filename-only exception when it remains simple and testable.

**Verify**: a primitive definition alone no longer fails; a direct native
control in app code still fails.

### Step 3: Evaluate Input and Textarea call sites

Extend `forms-have-labels` to inspect common native-wrapper component tags,
starting with `Input` and `Textarea`. At each call site, accept:

- non-empty `aria-label` or `aria-labelledby`;
- an explicit id matched by a native/Label `htmlFor`;
- a wrapping label;
- a non-empty `FormLabel` in the same nearest `FormItem` composition.

Do not accept `placeholder`, `name`, `FormMessage`, or `aria-describedby` as the
accessible name. Dynamic label evidence should remain advisory, not pass.

Avoid double-reporting the same call site through
`custom-controls-have-labels`. Keep one canonical finding ID for Input/Textarea
label failures: `forms-have-labels`.

**Verify**: all five new fixtures have the expected status and evidence path.

### Step 4: Improve evidence and remediation

When a wrapper component call fails, name the component and call site in the
evidence message. Keep the public finding ID and JSON shape stable. The
remediation should explicitly mention adding `FormLabel` for shadcn FormItem
composition.

**Verify**: the OrcDev-shaped test asserts file path and line, not only status.

### Step 5: Update contract and validate OrcDev

Bump the ruleset revision, regenerate docs, and add a changelog entry. Build and
run the accessibility scan against OrcDev.

Expected: `forms-have-labels` still fails, but evidence points to
`components/sections/newsletter/newsletter.tsx`, never
`components/ui/input.tsx`.

## Test Plan

- Direct native input with explicit label.
- Direct native input without label.
- Generated pass-through primitive definition.
- Input wrapper with aria-label.
- Input wrapper with explicit label/id.
- Valid shadcn FormItem/FormLabel composition.
- OrcDev FormItem without FormLabel.
- Dynamic FormLabel content returns advisory.
- Placeholder-only field fails.
- No duplicate failure from `custom-controls-have-labels`.

## Done Criteria

- [x] OrcDev's true form failure remains score-affecting.
- [x] Evidence points to both newsletter call sites, capped according to the
  report's evidence policy.
- [x] The reusable primitive is not reported as independently unlabeled.
- [x] Valid shadcn FormLabel composition passes.
- [x] Focused/full tests and all repository gates pass.
- [x] Ruleset/changelog updated and OrcDev untouched.

## STOP Conditions

- The only proposed fix is to ignore all files under `components/ui` without
  checking app call sites.
- Valid FormLabel composition cannot be distinguished from the OrcDev shape.
- Input/Textarea would be checked by two score-affecting rules.
- Fixing evidence requires a public schema change.

## Maintenance Notes

Add wrapper tags deliberately and with fixtures. Do not grow a broad list of
component names without proving their rendered control semantics.
