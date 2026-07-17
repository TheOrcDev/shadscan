# Releasing Shadscan

This runbook covers the unscoped public npm package `shadscan`. Run release
commands from `packages/cli`; the repository root is a private Next.js app and
must never be published.

## Owner Prerequisites

- Choose a public package license and commit `packages/cli/LICENSE` with the
  matching `license` manifest value.
- Use an npm user account with publishing two-factor authentication enabled.
- Restore GitHub Actions runner access before enabling automated publishing.
- Confirm `npm view shadscan` still returns `404` before the first publish.

Never commit an npm access token. The first release candidate is authenticated
interactively; later releases use npm Trusted Publishing with short-lived OIDC
credentials.

## Release Gates

From the repository root, run:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm docs:check
pnpm --filter shadscan typecheck
pnpm cli:test
pnpm test:api
pnpm typecheck
pnpm audit:dependencies
pnpm audit:self
pnpm build
pnpm cli:smoke
pnpm cli:release:check -- --tag next
```

For a stable release, replace `next` with `latest`. The release check rejects
an unlicensed package, a mismatched stable/prerelease version, install-time
scripts, workspace dependencies, incomplete package files, and malformed
registry metadata.

## First Release Candidate

The first publish claims the unscoped package name and must be performed by the
owner after reviewing the packed artifact.

1. Set the CLI package version to `0.1.0-rc.1` and update the changelog.
2. Commit and push the release-candidate preparation.
3. Run every release gate above.
4. Authenticate with `npm login` and confirm the account with `npm whoami`.
5. From `packages/cli`, run `npm publish --tag next` and complete 2FA.
6. Verify `npm view shadscan@next` and run the package in clean temporary
   Next, Vite, and generic React projects.

Do not move `latest` during release-candidate testing.

## Trusted Publishing

After the package exists on npm:

1. In the package's npm settings, add a GitHub Actions trusted publisher for
   `TheOrcDev/headless-shadcn` and `publish.yml`.
2. Allow staged publishing and require two-factor authentication for approval.
3. Restrict traditional token publishing after the trusted path succeeds.
4. Protect the GitHub `npm` environment with required reviewer approval.

The workflow must use a GitHub-hosted runner and `id-token: write`. Trusted
Publishing creates package provenance automatically; no npm token secret is
required.

## Stable Release

1. Set the package version to `0.1.0`, finalize the changelog, and run the
   `latest` release gates.
2. Commit, push, and create the signed `v0.1.0` tag.
3. Create the matching GitHub release. The publish workflow stages the npm
   artifact rather than publishing it immediately.
4. Download and inspect the staged tarball, then approve it on npm with 2FA.
5. Confirm `npm view shadscan@latest version` returns `0.1.0`.
6. Run `npx --yes shadscan@0.1.0 --version` and representative audits from a
   clean directory.
7. Only after those checks pass, replace source-preview commands in public
   documentation and product UI with `npx shadscan` examples.

## Consumer Guidance

- Local one-off: `npx shadscan`
- Monorepo target: `npx shadscan ./apps/web`
- Reproducible CI: `npx --yes shadscan@0.1.0 --fail-under 80`
- Lockfile-managed CI: install `shadscan` as a development dependency and run
  its bin through the project's package manager.

CI examples must pin an exact version. npm's `latest` tag is a moving pointer
and is not a reproducible build input.

## Recovery

Published name/version pairs are immutable. Never attempt to overwrite a bad
release.

1. Move `latest` back to the last known-good version when possible.
2. Deprecate the affected version with a message that names the replacement.
3. Fix forward with a new patch version.
4. Unpublish only for an urgent security or accidental-disclosure event and
   only when npm policy permits it.
