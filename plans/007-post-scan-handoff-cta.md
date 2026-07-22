# Plan 007: Post-scan handoff call to action

> **Executor instructions**: This plan changes the interactive CLI flow in
> `packages/cli`. Execute phases in order, keep all non-interactive behavior
> byte-identical, and run every verification command after each phase. No
> ruleset changes are involved — do not bump `BUNDLED_RULESET_VERSION`.
> Update `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `ls packages/cli/src/clipboard.ts 2>/dev/null && grep -n "copy" packages/cli/src/post-scan-actions.ts`
> If a clipboard module or copy actions already exist, reconcile instead of
> duplicating.

## Status

- **State**: PLANNED
- **Priority**: P1
- **Effort**: M
- **Risk**: LOW — interactive-only surface; CI, pipes, `--json`, `--prompt`,
  and `--no-interactive` paths must not change at all
- **Depends on**: none
- **Category**: feature/cli-ux
- **Planned at**: 2026-07-23

## Why This Matters

A bare `pnpm dlx @shadscan/cli@next` prints the report and then usually just
exits. The post-scan menu in `src/post-scan-actions.ts` exists, but
`runDefaultPostScanAction` in `src/cli.ts` returns early unless an installed
agent CLI was found or a pre-commit gate can be offered — so the most common
first-run experience (no claude/codex/grok on PATH) ends with no call to
action. And even when the menu shows, it offers no way to get the agent
handoff, which is the product's recommended workflow. The handoff should be
one keypress away after every interactive scan: copied to the clipboard and
printed, or skipped entirely for users who only wanted the score.

## Current State

- `src/post-scan-actions.ts` models the menu (`PostScanAction` union,
  `createPostScanMenu`, `promptPostScanAction`) with injected `ask`/`write`
  for tests, and `resolveInteractiveMode` already guards TTY, `CI`, and
  `SHADSCAN_INTERACTIVE=0`.
- `src/cli.ts` (`runDefaultPostScanAction`) has the early return
  `if (availableAgents.length === 0 && !includePreCommit) return;` and only
  looks for agents when `report.agentHandoff.workItems.length > 0`.
- `renderAgentPrompt(report)` produces the paste-ready handoff markdown and is
  already imported by `src/cli.ts` for `--prompt`.
- There is no clipboard capability anywhere in the CLI, and the package must
  stay dependency-light with no install scripts.

## Recommended experience (decision)

Do NOT gate the report behind an up-front "what do you want?" question. The
report itself is the answer for score-only users, an up-front prompt delays
first value, and it would fork rendering into modes. Instead:

1. Print the deterministic report exactly as today — the score is the first
   thing every user sees, so "just the score" stays the zero-decision path.
2. Always follow an interactive default scan with the menu, handoff first:

   ```
   What next?
   1. Copy the agent handoff — copies the paste-ready plan to your clipboard
      and prints it.
   2. Print the agent handoff — print it without touching the clipboard.
   3. Fix with Claude Code — validate and launch the provider from PATH.
   4. Add a pre-commit score gate — preview and confirm a Git hook.
   5. Done (Enter) — leave the project unchanged.
   ```

   Options 3–4 keep their existing availability rules; 1–2 appear whenever
   the handoff has work items; Done stays the default so pressing Enter
   remains "score only".
3. "Copy" both copies and prints, so the user leaves with the handoff visible
   even if their clipboard tooling is missing.

## Phase 1 — Clipboard adapter

New `src/clipboard.ts`, zero new dependencies, spawn with argument arrays and
no shell:

- Utility order by platform: `pbcopy` (darwin); `clip` (win32); `wl-copy`,
  then `xclip -selection clipboard`, then `xsel --clipboard --input` (linux),
  probing only whether the spawn succeeds.
- Fallback: OSC 52 (`]52;c;<base64>`) written to the TTY when the
  payload is at most 72 KiB after base64, since larger sequences are silently
  truncated by common terminals.
- Result contract: `{ copied: boolean; method: "utility" | "osc52" | null }`
  so callers can word the confirmation honestly and fall back to print-only.
- Inject the spawn implementation for unit tests, mirroring the `ask`/`write`
  injection style used by `post-scan-actions.ts`.

## Phase 2 — Menu and action wiring

- Extend `PostScanAction` with `{ kind: "copy-handoff" }` and
  `{ kind: "print-handoff" }`; add the two options to `createPostScanMenu`
  ahead of agent options when the caller says a handoff exists.
- In `runDefaultPostScanAction`:
  - Offer the menu whenever interactive and at least one option beyond Done
    exists; handoff options count, which removes the silent-exit path for
    users without agent CLIs.
  - `copy-handoff`: render once with `renderAgentPrompt(report)`, attempt the
    clipboard, print the handoff, then print either "Copied to clipboard." or
    "Clipboard unavailable; the handoff is printed above." — never fail the
    command over a clipboard problem.
  - `print-handoff`: print the same rendering.
- `--apply`'s dedicated menu path keeps its current shape (it exists to pick
  an agent, not to browse outputs).
- Non-interactive resolution, `--no-interactive`, `--json`, `--prompt`, CI,
  and non-TTY behavior stay byte-identical.

## Phase 3 (optional, separate commit) — non-interactive parity

A `--copy` flag that combines with the default human run and with `--prompt`
to copy the handoff without the menu. Skip if scope pressure appears; the
menu is the deliverable.

## Verification

| Purpose | Command | Expected |
|---------|---------|----------|
| Focused tests | `pnpm --filter ./packages/cli exec vitest run test/post-scan-actions.test.ts test/clipboard.test.ts` | exit 0 |
| Full CLI tests | `pnpm cli:test` | all pass |
| Typecheck | `pnpm --filter ./packages/cli typecheck` | exit 0 |
| Lint | `pnpm check` | exit 0 |
| Build + smoke | `pnpm cli:build && pnpm cli:smoke` | exit 0 |
| Self-audit | `pnpm audit:self` | score unchanged |

Test coverage to add:

- Menu composition: handoff options lead when work items exist; absent when
  the handoff is empty; Done remains the default on Enter and on invalid
  input reprompt.
- Copy action: clipboard adapter receives the exact rendered handoff;
  wording differs between copied and unavailable outcomes; print always
  happens.
- Clipboard adapter: platform utility selection with an injected spawn; OSC
  52 fallback emitted only under the size cap; failure returns
  `copied: false` without throwing.
- Regression: with no agents, no pre-commit offer, and no work items, the
  scan exits exactly as today.

## Close-out

- Update `docs/rules.md` is NOT needed (no rules); update the website docs
  pre-commit section wording ("the post-scan menu offers…") and the README
  Quick Start to mention the handoff CTA.
- Add an `## Unreleased` entry to `CHANGELOG.md`; ships with the next rc.
- Do not print OSC 52 when stdout is being piped even if stderr is a TTY —
  the guard is the existing `resolveInteractiveMode`, which already requires
  all three streams to be TTYs.

## Hard-won context for the executor

- The early return in `runDefaultPostScanAction` is the "no CTA" bug users
  hit; removing it is the point, but only for interactive runs — re-read
  `resolveInteractiveMode` before touching the condition.
- `report.agentHandoff.workItems.length` is already the signal the call site
  uses for agent discovery; reuse it for the handoff options so a perfect
  score with no work items still exits quietly.
- Menu tests drive `promptPostScanAction` through the injected `ask`; no PTY
  emulation is needed.
- Spawn clipboard utilities with argument arrays only; never build a shell
  string from report content.
