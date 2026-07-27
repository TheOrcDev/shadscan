# Plan 013: Cross-scope rule evidence (issue #10)

> **Executor instructions**: This plan fixes three false negatives
> reported in [issue #10](https://github.com/TheOrcDev/shadscan/issues/10).
> They share one root cause: the rules match patterns inside a single
> lexical scope, so idiomatic React composition — which spreads a working
> implementation across components and files — fails checks the rendered
> app actually passes. Work the phases in order. Phase 0 is a pure
> refactor with no behavior change and must land byte-identical report
> output (fixtures prove it). Bump `BUNDLED_RULESET_VERSION` to the next
> unused date-version **at execution time** — do not assume a number is
> free. Regenerate `docs/rules.md`, keep `scripts/verify-version-pins.mjs`
> green, add an Unreleased changelog entry per phase, and update
> `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `grep -rn "KEYDOWN_HANDLER_PATTERN\|SHADCN_SIDEBAR_COMPOSITION_PATTERN\|DISABLED_PENDING_PATTERN" packages/cli/src/rules/`
> If any of the three rules already resolves across files, reconcile
> against what shipped instead of re-implementing.

## Status

- **State**: DONE — ruleset `2026.07.39`
- **Priority**: P1 — these are false negatives on the officially
  documented shadcn patterns, reported by an external user against a
  first-party adapter.
- **Effort**: L
- **Risk**: MEDIUM-HIGH. Every change here **loosens** a rule, so the
  failure mode is the inverse of the usual one: not new false failures,
  but **false passes**. A rule that passes an app whose dark-mode
  shortcut does not actually work is worse than one that fails an app
  whose shortcut does. Every phase must resolve to a *verified*
  definition and bail to current behavior when resolution is ambiguous.
- **Depends on**: none
- **Category**: bugfix/detector
- **Planned at**: 2026-07-27
- **Reported against**: `@shadscan/cli` 0.2.0, TanStack Start + React

## Outcome (executed 2026-07-27)

Shipped as ruleset `2026.07.39`. Two deliberate deviations from the plan
as written:

1. **Phase 0 migrated two of the four call sites, not all four.**
   `high-confidence.ts` and `not-found-recovery-present.ts` have no
   alias fallback, so adopting the shared resolver would make them
   resolve *more* modules. That is a behavior change, and Phase 0 was
   specified as byte-identical. They keep their own resolvers; the
   consolidation is a follow-up.
2. **Phase 2 needed a second hop for the link.** Splitting the provider
   from the sidebar was not sufficient on real projects: a sidebar
   almost never holds its own links, it renders a nav component that
   does. Requiring `<a>`/`<Link>` beside `<Sidebar>` was the same
   single-file assumption one level down. Found by burn-in, not by the
   fixtures — `satnaing/shadcn-admin` was still flagged after Phase 2.

Burn-in covered four public projects. Exactly one status changed:

| Project | Adapter | Score | Flip |
|---|---|---|---|
| `shadcn-ui/ui` (apps/v4) | next-app-router | 34 → 34 | none |
| `shadcn/taxonomy` | next-hybrid-router | 44 → 44 | none |
| `dub` (apps/web) | next-app-router | 21 → 21 | none |
| `satnaing/shadcn-admin` | vite-react | 38 → 41 | `mobile-nav-present` fail → pass |

The single flip was verified by hand as a corrected false negative: Sheet
runtime at `ui/sidebar.tsx:182`, trigger at `layout/header.tsx:44`, links
at `nav-group.tsx:74`, mounted through
`authenticated-layout` → `AppSidebar` → `Sidebar` → `NavGroup`. Repeated
runs are byte-identical.

## Current State (verified 2026-07-27, at HEAD `29f716a`)

All three claims were reproduced at HEAD, not merely at the reported
0.2.0. `mobile-nav-present.ts` and `async-action-pending-state.ts` are
byte-identical to `v0.2.0` (`git diff v0.2.0..HEAD` is empty for both);
`high-confidence.ts` has changed, but `git log -S KEYDOWN_HANDLER_PATTERN`
shows the hotkey rule's patterns date to the original commit.

A repro fixture — a TanStack Start app using the exact idioms from the
issue — scores **44 (F)**, with all three rules failing:

| Rule | Status | Evidence |
|---|---|---|
| `theme-hotkey-present` | fail | "No safe dark-mode keyboard shortcut was found." |
| `async-action-pending-state` | fail | "missing visible pending feedback, a disabled trigger while pending" (`src/components/set-upload-form.tsx:11`) |
| `mobile-nav-present` | fail | "no verifiable responsive mobile trigger and controlled panel" (`src/components/app-sidebar.tsx:16`) |

The reporter is right on all three counts. Two things they could not
have known change the design, and are the reason this plan is not a
direct transcription of their suggestions:

### Correction 1 — the two hotkey libraries have opposite guard polarity

The issue suggests recognizing hooks "whose options ignore inputs". That
is correct for TanStack and **backwards** for `react-hotkeys-hook`.
Verified against the published type definitions:

- **`@tanstack/react-hotkeys@0.10.0`** — `ignoreInputs?: boolean`.
  Its default is *conditional on the key spec*: "true for single keys
  and Shift/Alt combos; false for Ctrl/Meta shortcuts and Escape". The
  reporter's `"Mod+Shift+D"` is a Meta/Ctrl combo, so it defaults to
  **false**, which is exactly why their code passes `ignoreInputs: true`
  explicitly. Their example is genuinely guarded.
- **`react-hotkeys-hook@5.3.3`** — has no `ignoreInputs`. It has
  `enableOnFormTags?: readonly FormTags[] | boolean`, defaulting to
  false, meaning it **already ignores form tags by default**. Here the
  guard is the *absence* of an opt-out.

A single "does it pass ignoreInputs: true" matcher would therefore
reject every correctly-guarded `react-hotkeys-hook` usage. The rule
needs a small per-library table, not one pattern.

Their signatures also differ — `useHotkey(key, cb, opts)` and
`useHotkeys(defs[], commonOpts)` in TanStack, versus
`useHotkeys(keys, cb, opts, deps)` in `react-hotkeys-hook` — so argument
positions cannot be shared either.

### Correction 2 — the render graph cannot see through a context provider

The obvious fix for claims 2 and 3 is to reuse the component render
graph, which already resolves JSX tags across files
(`component-render-graph/symbol-resolution.ts:511`, `resolveElementTarget`)
with ambiguity, cycle, and hop-budget handling. Probing the graph
against the fixture shows it half-works:

```
SURFACE tanstack-start:/:index.tsx  complete
    SetUploadForm    | resolved   | components/set-upload-form.tsx
    FormSubmitButton | resolved   | components/form-submit-button.tsx
    Spinner          | resolved   | ui/spinner.tsx
SURFACE tanstack-start:__root:__root.tsx  partial
    SidebarProvider        | resolved   | ui/sidebar.tsx
    SidebarContext.Provider| unresolved | -
```

Expansion of the root surface **stops dead** at
`<SidebarContext.Provider>`. `resolveElementTarget` handles a dotted tag
only when the root name is an imported *namespace* binding; a locally
created React context is not, so it returns unresolved. `AppSidebar`,
`main`, `SidebarTrigger` — every child projected through the provider —
never appear on the surface at all.

This is not a fixture artifact. It is the shape of the generated shadcn
`ui/sidebar.tsx`, and of `ThemeProvider`, `QueryClientProvider`, and
essentially every provider in every real app. **Any fix built on surface
reachability would be blocked below the first provider**, which in a
typical app is the second element in the tree.

The consequence for this plan: use **one-hop tag→file resolution**, not
surface expansion. One hop works — the graph resolved `SidebarProvider`
and `SetUploadForm` correctly — and it is all three fixes need, because
in every case the evidence is one or two component boundaries away, not
buried under a provider.

Deepening the resolver to treat `X.Provider` as a children pass-through
is a real and broadly valuable improvement — it would raise surface
completeness across every adapter — but it is a separate change with a
wide blast radius on existing surface fixtures. **Filed as follow-up,
explicitly out of scope here.**

### Incidental finding — five copies of module resolution

`resolveModuleName` is reimplemented in five places:
`rules/high-confidence.ts:234`, `rules/mounted-component-files.ts:177`,
`rules/not-found-recovery-present.ts:117`, `rules/toast-runtime.ts:257`,
and `component-render-graph/symbol-resolution.ts:27`. Phase 0 exists so
this plan does not add a sixth.

## Phase 0 — Shared one-hop symbol resolution

Pure refactor. No rule behavior changes; report output must be
byte-identical.

1. Add `packages/cli/src/rules/symbol-resolution.ts` exporting a helper
   in the shape the rules already need:
   - `resolveLocalBindingFile(project, file, localName, …)` → the
     `ParsedSourceFile` a local name's import resolves to, or `null`.
   - `resolveJsxTagFile(project, file, tagName, …)` → the same for a JSX
     tag name.
   Both keep the existing safety envelope verbatim:
   `createConfinedTypeScriptHost` + `host.isPathAllowed` +
   `isWithinProject`, and **exactly-one-definition or bail**
   (`getFunctionDefinitions(...).length === 1`), which is what makes the
   result verified rather than guessed.
2. Memoize the parsed-file map and compiler options per project, mirroring
   `parsedSourceFileCache` in `ast.ts:210`. Three rules building their own
   `Map` of every parsed file is the current cost; one shared cache is the
   fix.
3. Migrate the four rule-side call sites to it. Leave
   `component-render-graph/symbol-resolution.ts` alone — it resolves into
   graph `FileRecord`s, not `ParsedSourceFile`s, and merging the two is
   not worth the coupling.

**Verification**: `pnpm cli:test` green with no fixture edits. Audit this
repo and a burn-in repo before and after; the two JSON reports must be
identical.

## Phase 1 — `theme-hotkey-present`: declarative hotkey registration

Independent of the other phases; no cross-file work beyond resolving the
import. Ship it first.

1. Keep the existing `KEYDOWN_HANDLER_PATTERN` path untouched — it is the
   raw-listener case and still passes.
2. Add a second discovery path for declarative registrations. A scope
   qualifies only when **all** hold:
   - It calls `useHotkey` / `useHotkeys`, and that identifier resolves
     via its import to an **allowlisted module**: `@tanstack/react-hotkeys`
     or `react-hotkeys-hook`. A local function named `useHotkeys` must not
     qualify.
   - The key spec is a **static string literal** (or array of them). A
     variable or computed spec bails — unverifiable. Split on `+`; the
     final segment must be `d`, case-insensitive.
   - The callback toggles the theme, reusing the existing
     `DIRECT_THEME_TOGGLE_PATTERN` and
     `sourceScopeCallsVerifiedThemeToggle` against the callback body.
   - The typing-target guard is satisfied **per the library's own
     semantics** (see Correction 1):

   | Library | Guarded when |
   |---|---|
   | `@tanstack/react-hotkeys` | `ignoreInputs: true` explicitly; **or** omitted *and* the key spec is a bare key or a Shift/Alt-only combo (its documented conditional default) |
   | `react-hotkeys-hook` | `enableOnFormTags` omitted, `false`, or `[]` |

   Anything else — `ignoreInputs: false`, `enableOnFormTags: true`, a
   non-empty tag array, or a non-literal option value — fails, as today.
3. Put the library table in one module-level constant so a third library
   is a data change, not a code change.

**Risk**: the conditional-default branch is the one that can produce a
false pass. If encoding it proves fragile, require the explicit option
and accept a narrower fix — a false negative on an unusual spelling is
better than passing an app whose shortcut fires while the user is typing.

**Tests**: extend `packages/cli/test/` with fixtures for each row of the
table plus the negative cases: local `useHotkeys` shadowing the import,
non-literal key spec, `ignoreInputs: false`, `enableOnFormTags: true`.

## Phase 2 — `mobile-nav-present`: sidebar composition across files

The current gate is one regex requiring all three parts in a single file
(`mobile-nav-present.ts:81`):

```ts
const SHADCN_SIDEBAR_COMPOSITION_PATTERN =
  /<SidebarProvider\b[\s\S]*?<Sidebar\b[\s\S]*?<(?:a|Link)\b/;
```

The shadcn docs layout — and what `shadcn add sidebar` scaffolds — puts
`<SidebarProvider>` in the root layout and `<Sidebar>` in
`app-sidebar.tsx`, so it never matches. Note the *trigger* check
(`mobile-nav-present.ts:598`) is already cross-file; only the composition
check is not.

1. Split the pattern into two: a **provider mount** and a **sidebar
   composition** (`<Sidebar>` containing a link).
2. Do not simply accept "some file has each" — that would pass an app
   with an `app-sidebar.tsx` it never mounts. Instead require a proven
   link between them, using Phase 0's one-hop resolver: from the file
   mounting `<SidebarProvider>`, resolve each non-intrinsic JSX tag
   rendered beneath it; pass when one resolves to a file whose exported
   component composes `<Sidebar>` with a link. Allow the single-file case
   (provider and `<Sidebar>` together) to keep passing.
3. Report evidence at the **composition** file, matching today's
   `getTextLineNumber` behavior, so the pass reads the same way.

**Why one hop is enough**: `<AppSidebar />` is a direct child of
`<SidebarProvider>` in the documented layout. This deliberately does not
attempt full reachability — see Correction 2.

**Tests**: split layout (must pass), single-file layout (must still
pass), and the false-pass guard — an `app-sidebar.tsx` that exists but is
never rendered under a provider (must still fail).

## Phase 3 — `async-action-pending-state`: pending state through props

Most complex; land last. The rule needs pending state, a disabled
trigger, and visible feedback in one scope
(`async-action-pending-state.ts:36-45`); a shared form component that
owns the trigger UX fails at every call site.

1. When a scope has pending state but is missing the disabled trigger or
   visible feedback, do not fail immediately. Collect the scope's pending
   identifiers, then look for JSX attributes in that scope whose value
   expression **is** one of them (`isPending={isPending}`,
   `busy={isPending}`). Only a direct identifier reference, or a trivial
   boolean of them (`a || b`), counts — anything computed bails.
2. Resolve the receiving tag to its component file with Phase 0's helper,
   map the attribute name to the callee's parameter (destructured or
   `props.x`), and re-run the disabled/feedback checks there against the
   renamed identifier. Recurse with a **hop budget of 2**, which covers
   the reported case (call site → `SetUploadForm` → `FormSubmitButton`);
   exceeding it falls through to today's failure.
3. Bail to current behavior whenever resolution is ambiguous, the target
   is external, or the prop is spread (`{...props}`) — spreads make the
   rename untrackable and must not be assumed benign.
4. Keep the failure message pointing at the scope that owns the action,
   and extend it to say the prop chain was followed and where it ended,
   so a real miss stays actionable.

**Tests**: the reported two-hop chain (must pass), a chain where the
callee never disables (must still fail), a spread-props chain (must still
fail), an ambiguous target (must still fail), and a three-hop chain
(must still fail on budget).

## Verification (every phase)

- `pnpm cli:test`, `pnpm check`, `pnpm --filter ./packages/cli typecheck`.
- Regenerate `docs/rules.md` (`pnpm docs:rules`) and keep `pnpm docs:check`
  green.
- Re-run the issue-#10 repro fixture; the target rule must flip to pass
  while the other rules keep their prior status.
- **Determinism**: run each fixture twice and diff the JSON reports.
- **False-pass burn-in** — the load-bearing gate for this plan. Audit at
  least three public repos before and after each phase and diff the
  reports. Any rule that flips fail→pass must be inspected by hand and
  confirmed to actually work in the running app. Record the repos and
  verdicts in the PR body.
- Confirm scores only move for the intended rules; an unrelated score
  change means a shared helper leaked.

## Open Questions / Risks

1. **False passes are the whole risk.** Ordinary burn-in looks for new
   failures; this plan needs the opposite reading. Budget real time for
   inspecting every fail→pass flip.
2. **TanStack's conditional `ignoreInputs` default** is the single most
   likely source of a wrong pass. Narrowing to the explicit option is an
   acceptable retreat.
3. **Hop budgets are policy, not truth.** Two hops for props and one for
   the sidebar cover the documented idioms. Deeper composition stays a
   false negative — a known, bounded limit, and better than unbounded
   guessing.
4. **Context-provider pass-through** (Correction 2) is the deeper fix
   behind claims 2 and 3 and would lift surface completeness for every
   adapter. It needs its own plan and its own fixture review.
5. **Scoring impact**: these three rules are worth 5 + 4 + 3 = 12 points.
   Apps using these idioms will see scores rise on upgrade. Call it out
   in the changelog — a score moving without a code change needs an
   explanation, or it reads as instability.
6. **Version**: ships in the next minor (rules changed, no schema
   change). Reply on issue #10 when it lands, including the two
   corrections above — the reporter's `ignoreInputs` suggestion is right
   for their library and wrong in general, and they should know why the
   shipped rule looks different from what they proposed.
