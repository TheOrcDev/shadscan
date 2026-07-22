# Contributing to Shadscan

Thank you for helping improve Shadscan. Contributions can target the published
CLI, the product site, the hosted scanner and API, tests, or documentation.

Shadscan is designed to produce deterministic, evidence-backed audits without
executing or modifying the project being scanned. Changes should preserve that
trust boundary unless a new behavior is explicitly designed and documented.

## Before You Start

For focused bug fixes and documentation improvements, feel free to open a pull
request directly. Please open an issue before investing in a larger change,
especially one that affects:

- rules, scoring weights, or applicability;
- versioned CLI output, prompts, or hosted API contracts;
- source acquisition, privacy, security, or resource limits;
- database migrations or deployment infrastructure;
- package publishing and release automation.

Report vulnerabilities privately as described in the
[security policy](SECURITY.md). Do not include credentials, private source, or
exploit details in a public issue or pull request.

## Development Setup

Repository development uses Node.js 24 and pnpm 11.15.1. The published CLI must
remain compatible with Node.js 18 or newer.

From the repository root, install the locked dependency graph:

```bash
pnpm install --frozen-lockfile
```

Useful development commands:

```bash
# Build the CLI, then start the product site
pnpm dev

# Run the CLI directly against a project
pnpm cli:dev -- <project-path>

# Rebuild the distributable CLI
pnpm cli:build
```

Hosted scanner features require additional service configuration. See the
[hosted API](docs/hosted-api.md) and
[web scanner](docs/web-scanner.md) documentation before working on those
surfaces.

## Repository Map

| Area | Implementation | Tests and documentation |
| --- | --- | --- |
| Published CLI and rules | `packages/cli/src` | `packages/cli/test`, `docs/cli-contract.md`, `docs/rules.md` |
| Product site | `app`, `components` | `test/e2e` |
| Hosted scan API | `app/v1/scans`, `lib/shadscan-api` | `test/shadscan-api`, `docs/hosted-api.md` |
| Web repository scanner | `app/scan`, `lib/shadscan-web` | `test/shadscan-web`, `test/e2e`, `docs/web-scanner.md` |
| Database schema and migrations | `lib/db`, `drizzle` | database contract tests and `docs/database-roles.md` |
| Release automation | `.github/workflows`, `packages/cli/scripts` | `docs/releasing.md` |

The repository root is a private Next.js application. Only
`packages/cli` is published to npm.

## Implementation Guidelines

- Keep scans deterministic and read-only. The local CLI must not execute app
  code, mutate project files, upload source, or require application secrets.
- Treat repository contents and hosted archives as untrusted input. Preserve
  path confinement, archive limits, timeouts, error redaction, and worker
  isolation.
- Preserve public report schemas, exit statuses, prompt contracts, and hosted
  API envelopes unless the change intentionally versions them.
- Before changing Next.js behavior, read the relevant version-specific guide in
  `node_modules/next/dist/docs`. This repository's Next.js version may differ
  from APIs and conventions described by older guides.
- Prefer focused, typed changes that follow the surrounding code. Avoid
  unrelated cleanup in the same pull request.
- Maintain accessible, semantic UI behavior and cover interactive changes with
  keyboard and browser-level tests where appropriate.
- Add production dependencies only when the benefit justifies the runtime,
  security, and package-size cost.

The project uses Ultracite and Biome for formatting and linting:

```bash
# Check formatting and lint rules
pnpm check

# Apply automatic fixes, then review the resulting diff
pnpm fix
```

## Changing Audit Rules

A rule change is a public product change. When adding or changing a rule:

1. Add focused fixtures for passing, failing, not-applicable, and important
   false-positive cases.
2. Register or update the rule and its catalog metadata.
3. Update `BUNDLED_RULESET_VERSION` in `packages/cli/src/scan.ts` when behavior
   changes, along with tests that assert the version.
4. Regenerate the rule catalog with `pnpm docs:rules`.
5. Update the README files and `CHANGELOG.md` when counts or user-facing
   behavior change.

`docs/rules.md` is generated. Do not edit it by hand. Verify it is current with:

```bash
pnpm docs:check
```

## Database Changes

Start database changes in `lib/db/schema.ts`, then generate and validate the
corresponding Drizzle artifacts:

```bash
pnpm db:generate
pnpm db:check
```

Review and commit the intended migration files. Do not apply migrations to a
shared or production database; maintainers run migrations with the required
owner credentials.

## Tests

Run the smallest relevant suite while developing, then expand verification in
proportion to the change:

| Change area | Command |
| --- | --- |
| CLI, discovery, reports, or rules | `pnpm cli:test` |
| Hosted API | `pnpm test:api` |
| Web scanner | `pnpm test:web` |
| Product site or browser behavior | `pnpm test:e2e` |
| Types across the workspace | `pnpm typecheck` |
| Production build and trace checks | `pnpm build` |
| Packed npm artifact | `pnpm cli:smoke` |

Install Chromium once before running browser tests locally:

```bash
pnpm exec playwright install chromium
```

Tests should be deterministic and should not depend on live GitHub responses or
other mutable network state. Prefer the repository's existing fixtures and
mocked boundaries.

Pull requests run the complete quality workflow, including linting, generated
documentation checks, type checking, all test suites, the dogfood audit, the
production build, dependency auditing, and packed-CLI smoke tests.
The authoritative list lives in [`.github/workflows/quality.yml`](.github/workflows/quality.yml).

## Documentation and Changelog

- Update documentation in the same pull request as the behavior it describes.
- Add user-visible changes under `Unreleased` in `CHANGELOG.md`.
- Update `README.md` for repository-level guidance.
- Update `packages/cli/README.md` for content that should appear on npm.
- Keep versioned contracts in `docs/cli-contract.md`, `docs/hosted-api.md`, and
  the generated OpenAPI surface synchronized with their implementations.
- Treat `/agent/v1.md` as immutable published guidance. Breaking instruction
  changes require a new versioned route before updating the mutable
  `/agent.md` alias.

## Pull Requests

Keep each pull request focused and explain both the user impact and the reason
for the chosen approach. Include:

- a concise summary and any related issue;
- tests for behavioral changes;
- screenshots or recordings for visible UI changes;
- documentation and changelog updates where applicable;
- compatibility, privacy, or contract implications;
- the commands used to verify the change.

Commit subjects generally follow the existing Conventional Commit style, such
as `fix(web): handle an empty archive` or `feat(cli): add a rule`.

Before requesting review, confirm that the diff contains no credentials,
private repository data, generated build output, or unrelated local files.

## Releases

Releases are maintainer-managed. Contributors should not bump package versions,
create release tags, or publish to npm unless a maintainer explicitly requests
it. The complete release process is documented in the
[release guide](docs/releasing.md).
