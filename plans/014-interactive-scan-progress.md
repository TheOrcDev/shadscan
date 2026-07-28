# Plan 014: Interactive scan progress checklist

> **Executor instructions**: Add a dependency-free, CLI-owned progress
> checklist for interactive human scans. Keep reports on stdout, write progress
> to stderr, preserve every machine-readable and non-interactive surface, and
> run every verification command. Do not change report schemas, scoring, rules,
> or `BUNDLED_RULESET_VERSION`. Update this plan and `plans/README.md` when the
> work lands.
>
> **Drift check (run first)**:
> `ls packages/cli/src/scan-progress.ts 2>/dev/null`
> If a progress renderer already exists, reconcile instead of duplicating it.

## Status

- **State**: IN PROGRESS
- **Priority**: P1
- **Effort**: M
- **Risk**: MEDIUM - terminal animation must stop on every success and error
  path, and progress must never contaminate stdout or machine-readable output
- **Depends on**: none
- **Category**: feature/cli-ux
- **Planned at**: 2026-07-28

## Why this matters

The default CLI currently resolves the project, discovers its structure, runs
the audit, and prepares the report before writing anything. On a non-trivial
codebase this leaves an interactive user staring at a dead cursor for several
seconds, with no evidence that Shadscan started successfully or where it is in
the scan.

The completed report and post-scan menu already provide a strong result
experience. This plan improves only the silent interval before them.

## Current state

- `runScanAction` performs `resolveProjectPath`, `discoverProject`, and
  `scanProject` sequentially before writing the selected report format.
- `runSetupAction` performs the same silent scan before printing the current
  score and pre-commit plan.
- Human, JSON, and prompt reports own stdout.
- Interactive menus, warnings, confirmations, and launched-agent status
  already use stderr so stdout remains capturable.
- `resolveInteractiveMode` already suppresses interactive behavior in CI,
  non-TTY sessions, and when `--no-interactive` or
  `SHADSCAN_INTERACTIVE=0` is active.
- `terminal-capabilities.ts` already provides the color and Unicode decisions
  needed for graceful terminal fallbacks.
- `picocolors` is already a CLI production dependency.

## Approved experience

Normal scans and interactive setup use the same four phases:

```text
✓ Resolving project
✓ Discovering app structure
⠹ Evaluating UI rules
  Preparing report
```

On success, the active phase becomes a persistent completed line. After the
fourth phase completes, the existing report follows after one separating blank
line:

```text
✓ Resolving project
✓ Discovering app structure
✓ Evaluating UI rules
✓ Preparing report

Your shadscan score: ...
```

On failure, the active phase becomes a persistent failure line before the
existing redacted CLI error:

```text
✓ Resolving project
✓ Discovering app structure
✗ Evaluating UI rules

shadscan could not complete this command: ...
```

The first phase renders immediately. Completed phases do not show elapsed
times, rule counts, or file counts.

## Architecture

Add `packages/cli/src/scan-progress.ts` as a focused internal terminal module.
It owns:

- ordered phase state;
- spinner frames and the animation timer;
- in-place replacement of only the active stderr line;
- persistent success and failure lines;
- Unicode and ASCII symbols;
- optional color through existing terminal capabilities;
- timer cleanup on success and thrown errors.

The public shape should stay small and task-oriented. A phase runner accepts a
label plus a synchronous or asynchronous task, returns the task value, and
rethrows the original error after marking the phase failed. A disabled
implementation executes tasks without writing output or starting timers.

Do not hide the cursor, enable raw input, install process signal handlers, or
change stdin behavior. The timer must not keep Node alive.

## Command integration and data flow

Progress eligibility is decided by the command layer, not the renderer:

1. The selected format must be human.
2. Default interactivity must be enabled.
3. stdin, stdout, and stderr must all be TTYs.
4. CI and `SHADSCAN_INTERACTIVE=0` must remain suppressors through the existing
   interactive-mode resolver.

For a normal human scan:

1. `Resolving project` wraps `resolveProjectPath`.
2. `Discovering app structure` wraps `discoverProject`.
3. `Evaluating UI rules` wraps `scanProject`.
4. `Preparing report` wraps report normalization and human rendering.
5. The rendered report is written to stdout unchanged.

For interactive setup, use the same labels around the equivalent project
resolution, discovery, scan, and setup-result preparation work.

JSON, prompt, CI, piped, redirected, and explicitly non-interactive paths use
the disabled renderer. Their stdout and stderr behavior must stay unchanged.

## Error handling

- A rejected or thrown phase marks only the active phase as failed.
- Stop and clear the animation timer before rethrowing.
- Preserve the original error object so `bin.ts` and `normalizeCliFailure`
  continue to own redaction, stable messages, JSON error envelopes, and exit
  status.
- Do not print stack traces, internal paths, or project content from the
  progress renderer.
- If stderr cannot accept a write, do not convert a successful audit into a
  progress-only failure.

## Compatibility and non-goals

- No new production dependency.
- Published CLI compatibility remains Node.js 18 and newer.
- No report schema, prompt version, engine version, score, rule, or ruleset
  change.
- No hosted scanner or web UI progress changes.
- No percentages, counts, elapsed timings, phase telemetry, or profiling.
- No new flag for selecting a progress style.
- No cursor hiding, raw mode, or custom Ctrl+C semantics.

## Tests

Add focused unit coverage for the renderer:

- the first frame writes immediately;
- animation advances under fake timers;
- a completed phase clears the active line and leaves one persistent success
  line;
- a failed phase leaves one persistent failure line, stops the timer, and
  rethrows the same error;
- the disabled renderer executes tasks without terminal writes;
- Unicode/color and ASCII/no-color capabilities render suitable equivalents;
- timer handles are cleaned up and do not keep the process alive.

Extend CLI integration coverage:

- interactive human scans write the four phases to stderr and the existing
  report to stdout;
- interactive setup uses the same four labels;
- `--json`, `--prompt`, `--no-interactive`, CI, and non-TTY runs produce no
  progress output;
- score gates, errors, report contents, and exit statuses remain unchanged.

## Documentation

- Document interactive progress and its stderr ownership in
  `docs/cli-contract.md`.
- Mention immediate phase feedback in `README.md` and
  `packages/cli/README.md`.
- Add the user-visible improvement under `CHANGELOG.md` `Unreleased`.
- Include a before/after terminal transcript and compatibility notes in the
  pull request.

## Verification

| Purpose | Command | Expected |
|---------|---------|----------|
| Focused tests | `pnpm --filter ./packages/cli exec vitest run test/scan-progress.test.ts test/cli.test.ts` | exit 0 |
| Full CLI tests | `pnpm cli:test` | all pass |
| CLI typecheck | `pnpm --filter ./packages/cli typecheck` | exit 0 |
| Workspace lint | `pnpm check` | exit 0 |
| Build and packed smoke | `pnpm cli:build && pnpm cli:smoke` | exit 0 |
| Self-audit | `pnpm audit:self` | score unchanged |

## Completion criteria

- A user sees immediate, truthful phase feedback during an interactive scan.
- All four completed phases remain visible above the final report.
- Failure output identifies the failed phase without exposing internal details.
- Machine-readable and non-interactive contracts are unchanged.
- Tests, documentation, changelog, and verification evidence ship in the same
  focused pull request.
