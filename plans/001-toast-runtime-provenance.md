# Plan 001: Recognize Radix umbrella toast runtimes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If a STOP condition occurs, stop and report instead of
> improvising. When done, update this plan's row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 07a9eae..HEAD -- packages/cli/src/rules/high-confidence.ts packages/cli/src/rules/toast-provider-mounted.ts packages/cli/test/high-confidence-rules.test.ts packages/cli/test/state-rules.test.ts`
> Compare the current code with the excerpts below if these files changed.

## Status

- **State**: DONE
- **Priority**: P0
- **Effort**: M
- **Risk**: MED - runtime provenance must not accept placeholder toaster components
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `07a9eae`, 2026-07-19

## Why This Matters

OrcDev has a complete, mounted Radix toast implementation, but both toast rules
fail because Radix is imported through the `radix-ui` umbrella package and the
provider is one local-module hop below the mounted `Toaster`. This removes six
raw state points and produces two P1 handoff actions for working code. Both
rules need one shared definition of recognized runtimes and bounded local
provenance so their behavior cannot drift again.

## Current State

- `packages/cli/src/rules/high-confidence.ts:30-39` recognizes only `sonner`,
  `react-hot-toast`, and `@radix-ui/react-toast`.
- `packages/cli/src/rules/toast-provider-mounted.ts:16-22` duplicates that
  registry.
- `packages/cli/src/rules/toast-provider-mounted.ts:98-127` requires the
  exported mounted wrapper and recognized runtime import to be in the same
  file.
- OrcDev uses this valid chain:

```text
app/layout.tsx -> components/ui/toaster.tsx
components/ui/toaster.tsx -> components/ui/toast.tsx
components/ui/toast.tsx -> import { Toast as ToastPrimitives } from "radix-ui"
```

- The existing negative contract is important: a component named `Toaster`
  that only renders `<div aria-live="polite" />` must still fail.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused tests | `pnpm --filter shadscan exec vitest run test/high-confidence-rules.test.ts test/state-rules.test.ts` | exit 0 |
| Full CLI tests | `pnpm cli:test` | all tests pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint/format check | `pnpm check` | exit 0 |
| Build | `pnpm cli:build` | exit 0 |
| Self-audit | `pnpm audit:self` | score 100 and exit 0 |

## Scope

**In scope**:

- `packages/cli/src/rules/toast-runtime.ts` (new shared helper)
- `packages/cli/src/rules/high-confidence.ts`
- `packages/cli/src/rules/toast-provider-mounted.ts`
- `packages/cli/test/high-confidence-rules.test.ts`
- `packages/cli/test/state-rules.test.ts`
- `packages/cli/src/scan.ts`
- `docs/rules.md`
- `CHANGELOG.md`

**Out of scope**:

- OrcDev source files
- Adding toast packages to audited apps
- Treating arbitrary `aria-live` nodes as toast runtimes
- General-purpose whole-program symbol resolution

## Git Workflow

- Branch: `codex/001-toast-runtime-provenance`
- Use conventional commits, for example `fix: recognize radix toast wrappers`.
- Do not push or open a PR unless the operator asks.

## Steps

### Step 1: Add failing OrcDev-shaped fixtures

In both toast test suites, add a fixture with `radix-ui` in dependencies and
this three-file chain:

1. Root layout imports and mounts a local `Toaster`.
2. `Toaster` imports local `ToastProvider`, `Toast`, and `ToastViewport`, then
   renders them.
3. The local toast primitive imports `{ Toast as ToastPrimitives }` from
   `radix-ui` and exports the provider/root/viewport aliases.

Assert both `toast-provider-present` and `toast-provider-mounted` pass. Also add
a negative fixture with the `radix-ui` dependency but a placeholder local
`Toaster`; it must fail both rules.

**Verify**: run the focused tests before implementation. The new positive
fixtures must fail and the placeholder fixture must remain red only where
expected.

### Step 2: Centralize recognized toast runtime evidence

Create `packages/cli/src/rules/toast-runtime.ts`. It must own:

- recognized dependency names, including `radix-ui`;
- recognized direct import modules;
- named import validation for the umbrella package so an unrelated
  `radix-ui` import is not toast evidence;
- a helper that returns concrete runtime-import evidence with file and line;
- a bounded local-import traversal from a shell-mounted component to its
  implementation and dependencies.

Use TypeScript AST import declarations. Resolve relative imports and configured
path aliases with TypeScript module resolution. Traverse only project-local
modules, cap traversal depth at three, and track visited files to prevent
cycles. Do not inspect `node_modules` source.

**Verify**: focused tests compile; direct Sonner, direct Radix package, and
umbrella Radix fixtures all expose runtime evidence, while the placeholder does
not.

### Step 3: Make both rules consume the shared helper

Remove the duplicated toast dependency/import constants from both rule files.

- `toast-provider-present` passes only when a recognized runtime is installed,
  runtime import evidence exists, and a mounted provider/toaster is correlated
  with that runtime through the bounded local chain.
- `toast-provider-mounted` starts from the app shell and verifies the mounted
  component reaches a recognized runtime-backed provider.
- Preserve current direct-import behavior and evidence wording where possible.
- Failure evidence should distinguish missing dependency, missing runtime
  provenance, and missing shell mount.

**Verify**: focused tests pass, including the existing fake-toaster tests.

### Step 4: Update the ruleset contract

Bump `BUNDLED_RULESET_VERSION` to the next calendar revision, regenerate the
rule catalog, and add an Unreleased changelog item describing umbrella Radix
and local-wrapper recognition.

**Verify**: `pnpm docs:check` exits 0.

### Step 5: Run the complete gate

Run the full commands table. Then build and scan OrcDev:

```bash
node packages/cli/dist/cli.js /Users/orcdev/projects/orcdev --category states --json --no-roast
```

Both toast findings must pass. Other state failures must remain unchanged.

## Test Plan

- Positive: direct Sonner import and mount.
- Positive: direct `@radix-ui/react-toast` import and mount.
- Positive: OrcDev-style `radix-ui` named Toast import through two local files.
- Negative: installed runtime plus placeholder `Toaster`.
- Negative: unrelated named import from `radix-ui`.
- Negative: runtime-backed toaster exists but is not mounted in the shell.
- Negative: cyclic local imports terminate without hanging.

## Done Criteria

- [x] Both OrcDev toast findings pass.
- [x] Fake toaster fixtures still fail.
- [x] One shared runtime registry serves both rules.
- [x] Focused and full test suites pass.
- [x] Typecheck, lint, build, docs check, and self-audit pass.
- [x] Ruleset and changelog are updated.
- [x] No OrcDev files were modified.

## STOP Conditions

- TypeScript module resolution cannot resolve the target app's `@/` alias
  without changing public audit configuration.
- Passing OrcDev requires accepting a toaster solely by component name.
- The change would follow imports outside the audited project root.
- Existing direct-runtime fixtures regress after two reasonable attempts.

## Maintenance Notes

When adding another supported toast runtime, update only the shared registry and
its table-driven tests. Reviewers should verify that package presence alone can
never satisfy either rule.
