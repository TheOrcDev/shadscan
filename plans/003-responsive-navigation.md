# Plan 003: Recognize custom responsive navigation

> **Executor instructions**: Execute each step and verification in order. Stop
> on the stated conditions rather than weakening the checks. Update
> `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `git diff --stat 07a9eae..HEAD -- packages/cli/src/rules/mobile-nav-present.ts packages/cli/src/rules/nav-landmarks-have-names.ts packages/cli/test/interaction-rules.test.ts packages/cli/test/expanded-accessibility-rules.test.ts`

## Status

- **State**: DONE
- **Priority**: P0
- **Effort**: L
- **Risk**: MED - responsive class inference can create new false passes
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `07a9eae`, 2026-07-19

## Why This Matters

shadscan currently recognizes only Sheet/Drawer/Sidebar mobile panels and
globally counts every nav-like JSX element as simultaneously rendered. OrcDev
uses a working state-controlled custom panel, and its desktop/mobile landmarks
are mutually exclusive at the `lg` breakpoint. The two rules remove five raw
points despite browser verification showing exactly one functional navigation
landmark per viewport.

## Current State

- `mobile-nav-present.ts:5-10` hard-codes panel primitives and recognizes
  responsive evidence independently of state or content.
- OrcDev `components/navbar.tsx:72-118` has:
  - an accessible `Button` with `lg:hidden` and a menu label;
  - `isMenuOpen` state toggled by the button;
  - a `lg:hidden` panel whose visibility classes depend on `isMenuOpen`;
  - a nested `nav` with the mobile links.
- `nav-landmarks-have-names.ts:47-76` aggregates landmarks across every source
  file and ignores route composition and responsive exclusivity.
- At 320px, the desktop nav is `display:none`; the mobile nav becomes visible
  after opening the menu. At 1280px, the Radix desktop nav is visible and named
  `Main`; the mobile nav is hidden.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Focused tests | `pnpm --filter shadscan exec vitest run test/interaction-rules.test.ts test/expanded-accessibility-rules.test.ts test/scope-correlation.test.ts` | exit 0 |
| Full CLI tests | `pnpm cli:test` | all pass |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint/format check | `pnpm check` | exit 0 |
| Build | `pnpm cli:build` | exit 0 |
| Docs | `pnpm docs:check` | exit 0 |
| Self-audit | `pnpm audit:self` | score 100 and exit 0 |

## Scope

**In scope**:

- `packages/cli/src/rules/mobile-nav-present.ts`
- `packages/cli/src/rules/nav-landmarks-have-names.ts`
- Optional shared helper `packages/cli/src/rules/responsive-visibility.ts`
- `packages/cli/test/interaction-rules.test.ts`
- `packages/cli/test/expanded-accessibility-rules.test.ts`
- `packages/cli/test/scope-correlation.test.ts`
- `packages/cli/src/scan.ts`
- `docs/rules.md`
- `CHANGELOG.md`

**Out of scope**:

- Browser execution inside shadscan
- A complete Tailwind compiler
- Requiring Sheet/Drawer adoption in custom apps
- Fixing missing `aria-expanded` on OrcDev's trigger
- OrcDev source changes

## Git Workflow

- Branch: `codex/003-responsive-navigation`
- Commit example: `fix: recognize custom mobile navigation`.
- Do not push unless instructed.

## Steps

### Step 1: Capture the OrcDev mobile-nav pattern

Add a fixture matching the structure and state flow of OrcDev's `Navbar`:

```tsx
const [isMenuOpen, setIsMenuOpen] = useState(false);
<Button className="lg:hidden" onClick={() => setIsMenuOpen(!isMenuOpen)}>
  <span className="sr-only">Open main menu</span>
</Button>
<div className={cn("lg:hidden", isMenuOpen ? "visible" : "invisible")}>
  <nav><a href="/one">One</a></nav>
</div>
```

Expected: `mobile-nav-present` passes. Add negative fixtures where the panel
has no links/nav, the trigger does not control the panel state, or responsive
behavior is absent. Those must fail or become advisory, never pass.

### Step 2: Add bounded responsive visibility analysis

Create a small helper for static Tailwind visibility classes. It only needs to
model display visibility over named breakpoints for patterns already used by
the rules, including:

- `hidden md:flex`, `hidden lg:block`;
- `md:hidden`, `lg:hidden`;
- `max-md:hidden`, `max-lg:hidden`;
- unconditional `hidden` and visible display classes.

Represent each element's possible visible viewport intervals. If className is
dynamic beyond statically extractable branches, return unknown. Do not guess.
Two landmarks are mutually exclusive only when their known visible intervals
do not overlap.

**Verify**: table-driven helper tests cover overlapping, exclusive, always
visible, and unknown class combinations.

### Step 3: Recognize state-controlled custom mobile panels

Update `mobile-nav-present` to accept either:

- the current recognized primitive composition; or
- a generic responsive trigger and panel in one owned source scope.

For the generic path, require all of:

1. An interactive trigger with an accessible menu/navigation name.
2. A small-screen visibility interval.
3. A state update or equivalent control signal.
4. A panel whose class/hidden/open state references that same state.
5. A navigation subtree with at least one actionable link.

Use AST nodes and identifiers for correlation. Component names such as
`MenuButton` alone are not evidence.

**Verify**: OrcDev-shaped fixture passes; disconnected trigger/panel fixtures
do not.

### Step 4: Scope landmark comparison to co-renderable surfaces

Update `nav-landmarks-have-names` so a high-confidence failure requires
multiple landmarks that can coexist in the same owned component/route surface.

- Preserve failure for two concurrent unnamed native navs.
- Exclude pairs proven mutually exclusive by the responsive helper.
- Treat unresolved composition or dynamic visibility as advisory rather than a
  score-affecting fail.
- Model Radix `NavigationMenu` as a navigation landmark with its runtime default
  name `Main`; if multiple default-named menus coexist, they are not distinct
  and still require explicit labels.
- Do not globally add unrelated navs from different routes and claim they are
  simultaneous.

**Verify**: existing two-nav fixtures retain their outcomes; a desktop/mobile
exclusive pair passes; an unknown dynamic pair is advisory.

### Step 5: Update ruleset and validate OrcDev

Bump the ruleset revision, regenerate docs, and add an Unreleased changelog
entry. Build and run:

```bash
node packages/cli/dist/cli.js /Users/orcdev/projects/orcdev --category interaction --json --no-roast
node packages/cli/dist/cli.js /Users/orcdev/projects/orcdev --category accessibility --json --no-roast
```

Expected: `mobile-nav-present` and `nav-landmarks-have-names` pass. Command-menu
and link/form accessibility failures must remain unchanged.

## Test Plan

- Existing Sheet/Drawer/Sidebar positive fixtures.
- OrcDev state-controlled panel positive fixture.
- Trigger without controlled panel.
- Panel without navigation/actions.
- Desktop-only navigation.
- Two concurrent unnamed navs.
- Two concurrent distinctly named navs.
- Mutually exclusive desktop/mobile navs.
- Dynamic visibility that cannot be proven.
- Two coexisting Radix NavigationMenus using the same default name.

## Done Criteria

- [x] Both OrcDev navigation findings pass.
- [x] Existing concurrent unnamed-nav fixture still fails.
- [x] Generic mobile-nav pass requires correlated state and actionable content.
- [x] Unknown visibility never becomes a high-confidence pass.
- [x] Focused/full tests and all repository gates pass.
- [x] Ruleset/changelog updated and OrcDev untouched.

## STOP Conditions

- The proposed helper starts interpreting arbitrary Tailwind layout classes
  unrelated to visibility.
- A generic panel can pass without a correlated trigger or links.
- Fixing OrcDev requires treating all `lg:hidden` containers as mobile nav.
- Route composition cannot be bounded without a whole Next build; downgrade
  uncertain cases rather than inventing certainty.

## Maintenance Notes

Keep responsive inference deliberately small. Add a fixture for each newly
supported class pattern, and prefer advisory output whenever co-renderability
cannot be proven statically.
