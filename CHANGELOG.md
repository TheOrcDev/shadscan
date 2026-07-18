# Changelog

All notable changes to Shadscan will be documented in this file. Releases use
semantic versioning, with prereleases published under the npm `next` tag and
stable releases published under `latest`.

## Unreleased

### Fixed

- Form label checks now ignore generated prop-forwarding primitives and report
  unlabeled `Input`/`Textarea` usage at rendered call sites, including shadcn
  `FormItem` and `FormLabel` composition.
- Navigation checks now recognize correlated custom mobile panels and compare
  landmark names only when responsive visibility allows them to coexist.
- Next metadata checks now honor root-to-leaf inheritance, and loading checks
  target runtime-dynamic routes instead of every async page or event handler.
- Toast setup checks now recognize mounted local wrappers backed by the
  `radix-ui` Toast export while continuing to reject placeholder toasters.
- Theme shortcut and global hotkey checks now recognize verified local
  typing-target guard predicates instead of reporting safe shortcuts as missing.

## 0.1.0-rc.1 - 2026-07-18

### Added

- Deterministic audits across 55 rules and six weighted categories.
- Human, JSON, and paste-ready agent prompt output.
- Project-path scanning for Next App Router, Vite React, and generic React apps.
- Evidence-backed scoring, confidence, remediation, and agent actionables.
- Optional score thresholds for CI.
- Hosted scan API with authenticated GitHub and sanitized snapshot sources.
- MIT licensing for the publishable CLI package.

### Security

- Read-only local scanning with no source upload, telemetry, install script, or
  AI dependency.
- Archive extraction limits, source timeouts, authentication, and rate limits
  for the hosted API.

## 0.0.1

- Scaffolded the `shadscan` CLI package.
- Added project discovery for Next App Router, Vite React, and generic React apps.
- Added weighted scoring, confidence handling, JSON output, and `--fail-under`.
- Added first high-confidence rules for shadcn config, theme, metadata, favicon,
  route boundaries, and toast setup.
- Added AST-based accessibility checks for icon buttons, semantic interaction,
  form labels, and dialog titles.
- Added human report rendering with local roast copy and neutral CI/JSON output.
- Replaced the starter site with the Shadscan product and dogfood page.
