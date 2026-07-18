# Shadscan Implementation Plans

Generated from an audit of OrcDev on 2026-07-19. The audit used Shadscan
ruleset `2026.07.3` at Shadscan commit `07a9eae` against OrcDev commit
`50ef95b`, plus rendered checks against `https://orcdev.com` at 320px and
1280px.

The baseline scan was `62/100`. Five score-affecting findings were false
positives. Ruleset `2026.07.8` corrects those findings while preserving every
confirmed failure; the final external scan is `75/100`.

## Completion

All five plans were completed and pushed to `main`:

| Plan | Commit |
|------|--------|
| 001 | `f8a5ce7` |
| 002 | `fd0a185` |
| 003 | `c31c2dd` |
| 004 | `127d59f` |
| 005 | `9e6d803` |

## Execution Order And Status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Recognize Radix umbrella toast runtimes | P0 | M | - | DONE |
| 002 | Make Next metadata and loading checks route-aware | P0 | M | - | DONE |
| 003 | Recognize custom responsive navigation | P0 | L | - | DONE |
| 004 | Report form-label failures at rendered call sites | P1 | M | - | DONE |
| 005 | Tighten advisory evidence and add an OrcDev regression fixture | P1 | M | 001-004 | DONE |

Status values: TODO | IN PROGRESS | DONE | BLOCKED | REJECTED

## Audit Truth Table

| Finding | CLI status | Verdict | Evidence |
|---------|------------|---------|----------|
| `error-boundary-present` | fail | Confirmed | OrcDev has no `app/error.tsx` or component error boundary. |
| `toast-provider-present` | fail | False positive | `app/layout.tsx:65` mounts `Toaster`; `components/ui/toast.tsx:5` uses Radix Toast from `radix-ui`. |
| `metadata-title-description-complete` | fail | False positive | Root metadata supplies a description, which Next inherits on the blog route. The rendered route has a non-empty description. |
| `command-menu-present` | fail | Confirmed | No command component or command-menu composition exists. |
| `command-menu-hotkey-present` | fail | Confirmed | No Cmd/Ctrl+K handler exists. |
| `mobile-nav-present` | fail | False positive | `components/navbar.tsx:72-118` has a mobile trigger, state-controlled panel, responsive classes, and links. It works at 320px. |
| `route-loading-boundary-present` | fail | Confirmed, wrong evidence | The cited blog route is prerendered. `app/videos/page.tsx:5-22` is force-dynamic, awaits data, and has no loading boundary. |
| `suspense-fallback-useful` | fail | Confirmed | `app/unsubscribe/page.tsx:48` omits `fallback`, producing a blank pending state. |
| `empty-state-present` | fail | Confirmed | `app/videos/page.tsx:26` maps `items` without handling the empty array returned by `app/videos/index.ts:9-11`. |
| `toast-provider-mounted` | fail | False positive | The mounted local toaster renders Radix `ToastProvider` and `ToastViewport`; the live accessibility tree exposes a Notifications region. |
| `images-have-alt` | advisory | Verified good | Blog cover images resolve to meaningful dynamic alt text at runtime. The advisory is honest static uncertainty. |
| `links-have-accessible-names` | fail | Confirmed | The setup route renders 12 unnamed links: ten arrow links and two avatar links. |
| `iframes-have-title` | advisory | Verified good | All 40 rendered YouTube iframes have meaningful video-title values. |
| `nav-landmarks-have-names` | fail | False positive | Desktop and mobile navs are mutually exclusive. Exactly one is visible at each breakpoint; the desktop Radix nav is named `Main`. |
| `no-nested-interactive-controls` | fail | Confirmed | The rendered 404 contains a `button` inside an anchor. |
| `heading-structure-sane` | advisory | Confirmed | `/setup` renders two `h1` elements. |
| `destructive-actions-confirmed` | advisory | False positive | The evidence is a non-interactive `Badge` whose visual variant is `destructive`; no destructive action exists there. |
| `color-contrast-passes` | advisory | Verified good | The cited muted text is 4.80:1 in light mode and 6.93:1 in dark mode. |
| `pointer-target-size-passes` | advisory | Verified good | Tested representative routes at 320px and 1280px. Undersized text links have more than 24px center spacing; controls are otherwise at least 24px. |
| `mobile-overflow-absent` | advisory | False positive | The match is `sizes="...100vw"` on a responsive image, not layout width. Tested routes have `scrollWidth === clientWidth` at 320px. |
| `forms-have-labels` | fail | Confirmed, wrong evidence | The primitive is not the violation. The two unlabeled rendered inputs are at `components/sections/newsletter/newsletter.tsx:90` and `:102`. |

## Confirmed OrcDev Backlog

These are app issues, not Shadscan defects. They are intentionally outside the
five scanner plans:

1. Add `app/error.tsx` with a recovery action.
2. Decide whether this portfolio should adopt Shadscan's opinionated command
   menu requirement; if yes, add the menu and Cmd/Ctrl+K together.
3. Add loading UI for the force-dynamic videos route.
4. Add a visible Suspense fallback to unsubscribe.
5. Add an empty state to videos.
6. Label all setup equipment and sponsor-avatar links.
7. Replace the nested 404 Link/Button composition with `Button asChild`.
8. Add visible `FormLabel` elements to both newsletter fields.
9. Change the second setup `h1` to `h2`; separately inspect the duplicated
   blog `h1` produced by the markdown body, which Shadscan currently misses.

## Dependency Notes

- Plans 001-004 are independent behavior slices and may be executed in any
  order.
- Plan 005 adds the combined OrcDev-pattern regression fixture, so execute it
  after Plans 001-004.
- Every behavior slice must bump the bundled ruleset version, regenerate
  `docs/rules.md`, and add an Unreleased changelog entry.

## Findings Considered And Rejected

- Do not suppress dynamic image-alt or iframe-title advisories globally. They
  are score-neutral and accurately communicate static uncertainty; the OrcDev
  values were verified at runtime.
- Do not turn contrast or pointer-size checks into static passes. Their current
  score-neutral browser-verification contract is correct.
- Do not remove command-menu scoring as part of false-positive work. Whether a
  command menu belongs in a small portfolio is a product-policy decision, not a
  detector bug.
- Do not change OrcDev source while executing these plans. OrcDev is the
  external validation target; fixes belong in Shadscan.
