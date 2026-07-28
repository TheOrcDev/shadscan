# shadscan Implementation Plans

Numbered plans capture larger behavior slices before execution: motivation,
current state, phased scope, verification commands, and hard-won context for
the executor. Each plan is marked DONE with its landing commit when complete.

## Plan Index

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001–005 | External-validation detector fixes (five behavior slices from a real-site audit; ruleset `2026.07.3` → `2026.07.8`) | P0–P1 | – | – | DONE (`f8a5ce7`, `fd0a185`, `c31c2dd`, `127d59f`, `9e6d803`) |
| 006 | Manifest-driven component anatomy rules | P2 | L | - | DONE (`0a2d1ff`) |
| 007 | Post-scan handoff call to action | P1 | M | - | DONE (`15fd501`) |
| 008 | Arrow-key selection for the post-scan menu | P2 | M | 007 | DONE (`5dc0870`) |
| [009](009-tanstack-start-adapter.md) | TanStack Start framework adapter | P1 | L | - | DONE (`935ef41`) |
| [010](010-laravel-inertia-react-adapter.md) | Laravel (Inertia + React) framework adapter | P1 | XL | - | DONE (`973d979`) |
| [011](011-astro-react-adapter.md) | Astro (React islands) framework adapter | P1 | XL | - | DONE (`0edefab`) |
| [012](012-react-router-framework-adapter.md) | React Router (framework mode) adapter | P1 | L | - | DONE (`97a874c`) |
| [013](013-cross-scope-rule-evidence.md) | Cross-scope rule evidence (issue #10 false negatives) | P1 | L | - | DONE (`5c37154`) |
| [014](014-monorepo-workspace-scanning.md) | Monorepo workspace scanning and pooled scoring | P1 | XL | - | DONE |
| [015](015-interactive-scan-progress.md) | Interactive scan progress checklist | P1 | M | - | DONE (`56a3dfc`, `579afad`, `0cf5b45`) |

Status values: TODO | IN PROGRESS | DONE | BLOCKED | REJECTED

## Conventions

- Plans 001–005 were driven by an audit of a real external site; their
  detailed write-ups have been retired from the repository, and the detector
  behavior they fixed is locked in by regression fixtures under
  `packages/cli/test/`.
- Every behavior slice that changes rules must bump the bundled ruleset
  version, regenerate `docs/rules.md`, and add an Unreleased changelog entry.
- Score-affecting rule changes ship advisory-first and are promoted only
  after a false-positive burn-in against external repositories.
