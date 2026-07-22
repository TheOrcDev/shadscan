# Plan 008: Arrow-key selection for the post-scan menu

> **Executor instructions**: This plan replaces the numbered text prompt in
> `packages/cli/src/post-scan-actions.ts` with an in-place arrow-key selector.
> No new dependencies. Keep the injected-`ask` and non-raw-TTY fallbacks
> working, keep all non-interactive surfaces byte-identical, and run every
> verification command. No ruleset changes — do not bump
> `BUNDLED_RULESET_VERSION`. Update `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `ls packages/cli/src/interactive-select.ts 2>/dev/null`
> If the selector module exists, reconcile instead of duplicating.

## Status

- **State**: PLANNED
- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM — raw-mode terminal handling must always restore the
  terminal (cursor, raw mode) on every exit path, including SIGINT and
  thrown errors; a broken terminal is worse than a numbered menu
- **Depends on**: Plan 007 (shipped in 0.1.0-rc.6)
- **Category**: feature/cli-ux
- **Planned at**: 2026-07-23

## Why This Matters

The post-scan menu shipped in rc.6 asks users to type `1`–`5` and press
Enter. Modern CLIs let users move a highlighted row with the arrow keys and
confirm with Enter; the typed-number flow reads as dated and adds a
keystroke. The menu is now the product's primary call to action, so its feel
matters.

## Current State

- `promptPostScanAction` renders a static numbered list and loops on
  `readline.question` until a valid number or empty answer (Done) arrives.
- Tests drive selection through the injected `ask` callback; no PTY
  emulation exists in the suite.
- `picocolors` is already a dependency, and `terminal-capabilities.ts`
  already resolves color and unicode support for the report renderer.
- The menu only ever runs when stdin, stdout, and stderr are all TTYs
  (`resolveInteractiveMode`), but raw-mode support is a stricter capability
  than "is a TTY" and must be probed separately.

## Recommended experience (decision)

```
What next?
❯ Copy the agent handoff      copy the plan to your clipboard and print it
  Print the agent handoff     print it without copying
  Fix with Claude Code        validate and launch the provider from PATH
  Add a pre-commit score gate
  Done                        leave the project unchanged
↑/↓ move · Enter select · Esc done
```

- Arrow keys (and `k`/`j`) move the highlight with wrap-around; Enter
  confirms the highlighted row.
- Number keys stay as instant-select shortcuts, preserving the old muscle
  memory and giving tests and power users a one-keystroke path.
- `Esc` and `q` select Done immediately. Ctrl+C restores the terminal and
  exits with the standard interrupt behavior.
- **Initial highlight sits on the first option — the handoff CTA — so the
  happy path is a single Enter.** This intentionally changes rc.6's "Enter
  keeps just the score" contract into "Esc keeps just the score"; the copy
  action is harmless (clipboard plus print), the CTA is the reason the menu
  exists, and the hint line makes the exit obvious. Docs, README, and the
  option descriptions must be updated in the same commit.
- Unicode pointer `❯` with a plain `>` fallback and highlight via
  picocolors inverse/cyan, degrading to the pointer alone under `NO_COLOR`
  (reuse `terminal-capabilities.ts` resolution).

## Phase 1 — Selector primitive

New `packages/cli/src/interactive-select.ts`, zero dependencies beyond
picocolors:

- `selectFromMenu({ options, initialIndex, input, output, capabilities })`
  returning `Promise<number>`; options carry `label` and `description`.
- Implementation: `readline.emitKeypressEvents(input)`,
  `input.setRawMode(true)`, render the block once, then re-render in place
  with ANSI cursor-up and line-clear sequences on every move; hide the
  cursor during interaction.
- A single `finally` path restores raw mode, re-shows the cursor, and
  removes listeners — on selection, Escape, Ctrl+C, and thrown errors alike.
- `supportsRawSelection(input)` guard: `input.isTTY && typeof
  input.setRawMode === "function"`. When false, callers fall back to the
  existing numbered prompt unchanged.
- Injected `input`/`output` streams keep it unit-testable without a PTY: a
  fake stream emits keypress sequences; assertions cover down/up movement,
  wrap-around, Enter, Esc, `q`, number shortcuts, and terminal restoration
  (raw mode off, cursor shown) on every exit path.

## Phase 2 — Menu integration

- `promptPostScanAction` prefers the selector when no `ask` override is
  given and `supportsRawSelection` holds; otherwise it uses the current
  numbered flow verbatim (tests and exotic terminals keep working).
- Selected index maps to the existing `PostScanAction` values; Esc/`q`
  resolve to the Done action.
- The external-agent warning line stays above the menu when agent options
  are present.
- Update the docs pre-commit paragraph, the README Quick Start mention, and
  `CHANGELOG.md` `## Unreleased` to describe arrow-key selection and the new
  "Esc keeps just the score" exit.

## Phase 3 — Manual PTY smoke (verification aid, not shipped code)

Drive the built CLI once under `script -q /dev/null` piping an arrow-key
escape sequence (`[B\n`) and assert the second option executed —
mirrors how rc.6's menu was smoke-tested in-session. Document the command in
the plan close-out notes; do not add PTY dependencies to the suite.

## Verification

| Purpose | Command | Expected |
|---------|---------|----------|
| Focused tests | `pnpm --filter ./packages/cli exec vitest run test/interactive-select.test.ts test/post-scan-actions.test.ts` | exit 0 |
| Full CLI tests | `pnpm cli:test` | all pass |
| Typecheck | `pnpm --filter ./packages/cli typecheck` | exit 0 |
| Lint | `pnpm check` | exit 0 |
| Build + smoke | `pnpm cli:build && pnpm cli:smoke` | exit 0 |
| Self-audit | `pnpm audit:self` | score unchanged |

## Hard-won context for the executor

- Never leave the terminal in raw mode: every test asserts restoration, and
  the implementation must restore in `finally`, not in the happy path.
- Keypress events for arrows arrive as `{ name: "up" | "down" }` with
  `sequence` values like `[A`; handle both `name` and raw sequences so
  minimal terminals work.
- Re-render with cursor-up plus clear-line per menu row rather than a full
  screen clear, so the report above the menu never flickers or scrolls.
- stderr is the menu's output stream (the report owns stdout); keep the
  selector rendering on the same stream the current menu uses.
- The `ask` injection path is load-bearing for the existing test suite —
  the selector must be additive, not a rewrite of that contract.
