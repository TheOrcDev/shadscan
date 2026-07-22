---
name: shadscan-release
description: Cut and publish a new @shadscan/cli version to npm, including version bump, CHANGELOG.md and site changelog entries, the full release gate suite, npm publish under the next or latest dist-tag, published-artifact verification in clean fixture projects, and post-publish checks. Use when the user asks to release, publish, ship, or cut a new shadscan or @shadscan/cli version, or to prepare a release candidate.
---

# Shadscan release

Ship one new `@shadscan/cli` version to npm with its changelog entries and
verification. Prereleases (`0.1.0-rc.N`) publish under the npm `next` tag;
stable releases publish under `latest` through the staged GitHub workflow.

Before acting, read `docs/releasing.md` in full — it is the source of truth
for owner prerequisites, gates, trusted publishing, and recovery. Keep this
skill as the executable coordinator; never weaken or skip the runbook's gates.

## Completion contract

- One release = one strictly higher, previously unpublished version. Confirm
  absence with `npm view @shadscan/cli versions --json` before starting.
  Published name/version pairs are immutable — corrections always fix forward
  with a new version, never a republish.
- A release is complete only when: the version is live on npm under the
  intended dist-tag, the exact published version runs `--version` and a real
  audit from a clean directory, the dist-tag map is inspected and correct, and
  both changelog surfaces (root `CHANGELOG.md` and `changelog/<version>.md`)
  are committed and pushed.
- Publish only from `packages/cli`. The repository root is a private Next.js
  app and must never be published.
- npm 2FA belongs to the owner. Prepare and run the publish command for them,
  but never attempt to bypass, script, or wait out the 2FA prompt; hand the
  terminal to the owner at that step.
- If any gate fails, stop and report the exact failing gate. Never publish a
  version whose gates did not all pass on the exact commit being published.

## Prerequisites

- Clean working tree on up-to-date `main` (no uncommitted or unrelated WIP —
  the gates verify the tree as a whole).
- Node.js version from `.node-version` and pnpm from the root `packageManager`
  field.
- Owner is present for `npm login` / `npm whoami` and 2FA at publish time.
- The target version does not exist on npm yet.

## 1. Prepare the version and changelogs

1. Bump `packages/cli/package.json` to the next unused version.
2. Update root `CHANGELOG.md`: move the `## Unreleased` content into a new
   `## <version> - <YYYY-MM-DD>` section with `### Added / Changed / Fixed /
   Security` groupings, and leave an empty `## Unreleased` behind.
3. Write the narrative site entry at `changelog/<version>.md`:
   - Frontmatter: `version`, `date`, `channel` (`next` for prereleases,
     `latest` for stable), `title`, `summary`, `highlights` (3–5 bullets).
   - Body: a few `##` sections telling the release as a story for users, not
     a commit list. Write it from the new CHANGELOG.md section.
   - The loader (`lib/changelog.ts`) validates the frontmatter at build time —
     `pnpm ci:build-site` failing on `/changelog` means the entry is malformed.
4. Verify the three versions agree: `packages/cli/package.json`,
   the new `CHANGELOG.md` heading, and the `changelog/<version>.md`
   frontmatter.
5. Commit the preparation and push.

## 2. Run every release gate

From the repository root, per `docs/releasing.md`:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm docs:check
pnpm --filter ./packages/cli typecheck
pnpm cli:test
pnpm test:api
pnpm test:web
pnpm exec playwright install chromium
pnpm test:e2e
pnpm typecheck
pnpm audit:dependencies
pnpm audit:self
pnpm build
pnpm cli:smoke
CLI_VERSION=$(node -p "require('./packages/cli/package.json').version")
pnpm cli:release:check -- --tag next --git-tag "v${CLI_VERSION}"
```

For a stable release, use `--tag latest` and the matching stable Git tag.
`pnpm build` also proves the new `/changelog` entry renders and the
production trace verifier passes.

## 3. Publish

### Prerelease (`next`)

1. Owner authenticates: `npm login`, confirm with `npm whoami`.
2. Run `(cd packages/cli && npm publish --tag next --access public)` and let
   the owner complete 2FA.

### Stable (`latest`)

Follow the staged flow in `docs/releasing.md`: signed `v<version>` Git tag,
GitHub release, the publish workflow stages the artifact, owner inspects the
staged tarball and approves on npm with 2FA.

## 4. Verify the published artifact

1. Inspect the tag map: `npm view @shadscan/cli dist-tags --json`. Confirm
   the new version is under the intended tag and `latest` did not move
   unintentionally during a prerelease.
2. Run the exact published version from a clean directory:
   `npx --yes @shadscan/cli@<version> --version`.
3. Run representative audits of the published version in clean temporary
   Next.js, Vite React, and generic React fixture projects. Run one fixture
   twice and confirm the two reports are identical — determinism is the
   product promise.
4. Verify the deployed site: `/changelog` shows the new entry, and the audit
   badge/scoring flows still work (site examples stay pinned to `@next` or an
   exact version during the RC window).

## 5. Close out

- Announce from `changelog/<version>.md` content only after verification
  passes (the summary paragraph is written to be quotable).
- For a stable release only: replace `@next`-pinned examples in public docs
  and UI with unqualified `@shadscan/cli` commands, per the runbook.
- If anything shipped broken: move the dist-tag back to the last good
  version, `npm deprecate` the bad version naming its replacement, and fix
  forward. Unpublish only for security or accidental disclosure, per policy.

## Hard-won rules

- Any new top-level file or directory in this repository must be added to
  `SCANNER_TRACE_EXCLUDES` in `next.config.ts`, or `pnpm build` fails in the
  postbuild trace verifier ("unrelated source"). This has broken the build
  before (CONTRIBUTING.md).
- npm requires every package to keep a `latest` tag: the first publish got
  `latest` even with `--tag next`. During the RC window, never advertise the
  unqualified package name; keep every public command pinned to `@next` or an
  exact version.
- Verify with `npx --yes @shadscan/cli@<exact-version>`, not a dist-tag —
  runner caches can serve a stale tag resolution minutes after publish.
- The local shadscan audit binary (`node_modules/.bin/shadscan`) breaks when
  `packages/cli/dist` is mid-rebuild; use the published one-shot
  (`pnpm dlx @shadscan/cli@next --json`) for pre-commit audits during release
  work.
- Yaml frontmatter parses unquoted dates as Date objects; the changelog
  loader normalizes this, but keep `date:` in `YYYY-MM-DD` form anyway.
- The `ci:*` script variants skip the CLI rebuild; local release work must use
  the ordinary commands so lifecycle hooks rebuild the CLI and stale output
  cannot be verified or published.
