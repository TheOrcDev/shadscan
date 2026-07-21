# Releasing shadscan

This runbook covers the public scoped npm package `@shadscan/cli`. The product
and installed executable remain named `shadscan`. Run release commands from
`packages/cli`; the repository root is a private Next.js app and must never be
published.

## Owner Prerequisites

- Keep `packages/cli/LICENSE` and the package manifest aligned on the MIT
  license.
- Confirm the `@shadscan` npm organization exists and the release account can
  publish packages in its scope.
- Use an npm user account with publishing two-factor authentication enabled.
- Restore GitHub Actions runner access before enabling automated publishing.
- Confirm the target version is absent from `npm view @shadscan/cli versions
  --json` before publishing it.

The package manifest sets `publishConfig.access` to `public` and pins the
public npm registry. Keep those settings intact. Manual publishes also pass
`--access public` explicitly because scoped packages otherwise default to
restricted visibility.

Never commit an npm access token. The first release candidate is authenticated
interactively; later releases use npm Trusted Publishing with short-lived OIDC
credentials.

## Release Gates

Use Node.js 24 from `.node-version` and pnpm 11.15.1 from the root
`packageManager` field for repository and release work. The packed-package CI
matrix separately proves that the published CLI still runs on Node.js 18.

From the repository root, run:

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

For a stable release, replace `next` with `latest` and supply the matching
stable Git tag. The release check rejects
an unlicensed package, a mismatched stable/prerelease version, install-time
scripts, workspace dependencies, incomplete package files, and malformed
registry metadata.

The CI workflows build the CLI once, then use the internal `ci:*` script
variants for every dependent gate. Keep the ordinary commands above for local
release work; their lifecycle hooks deliberately rebuild the CLI so stale
output cannot be verified or published by accident.

## Prerelease

Publish each release candidate under `next` after an authorized organization
member reviews the packed artifact.

1. Set the CLI package version to the next unused prerelease and update the
   changelog.
2. Commit and push the release-candidate preparation.
3. Run every release gate above.
4. Authenticate with `npm login` and confirm the account with `npm whoami`.
5. From the repository root, run
   `(cd packages/cli && npm publish --tag next --access public)` and complete
   2FA. The explicit access flag matches the existing `publishConfig.access`
   safeguard.
6. Verify `npm view @shadscan/cli@next` and run the exact published version with
   `npx --yes @shadscan/cli@<version> --version` plus representative audits in
   clean temporary Next, Vite, and generic React projects.

Do not intentionally move `latest` during release-candidate testing. Inspect
the complete tag map with `npm view @shadscan/cli dist-tags --json` after every
publish.

npm requires every package to retain a `latest` tag. The first public version
was therefore assigned to both `latest` and `next` even though it was published
with `--tag next`; attempting to delete that sole `latest` pointer is rejected
by the registry. Leave the unavoidable pointer in place until the first stable
release, keep all release-candidate instructions pinned to `@next` or an exact
version, and never advertise the unqualified package command during this
window. The stable publish replaces the prerelease pointer with `0.1.0`.

## Trusted Publishing

After the package exists on npm:

1. In the package's npm settings, add a GitHub Actions trusted publisher for
   `TheOrcDev/shadscan` and `publish.yml`.
2. Allow staged publishing and require two-factor authentication for approval.
3. Restrict traditional token publishing after the trusted path succeeds.
4. Protect the GitHub `npm` environment with required reviewer approval.

The workflow must use a GitHub-hosted runner and `id-token: write`. Trusted
Publishing does not require an npm token secret. npm provenance is unavailable
while the source repository is private; it starts automatically only after the
repository is public.

## Stable Release

1. Set the package version to `0.1.0`, finalize the changelog, and run the
   `latest` release gates.
2. Commit, push, and create the signed `v0.1.0` tag.
3. Create the matching GitHub release. The publish workflow stages the npm
   artifact rather than publishing it immediately.
4. Download and inspect the staged tarball, then approve it on npm with 2FA.
5. Confirm `npm view @shadscan/cli@latest version` returns `0.1.0`.
6. Run `npx --yes @shadscan/cli@0.1.0 --version` and representative audits from
   a clean directory.
7. Only after those checks pass, replace source-preview commands in public
   documentation and product UI with `npx @shadscan/cli` or
   `pnpm dlx @shadscan/cli` examples.

## Consumer Guidance

- npm one-off: `npx --yes @shadscan/cli`
- pnpm one-off: `pnpm dlx @shadscan/cli`
- Monorepo target: `pnpm dlx @shadscan/cli ./apps/web`
- Reproducible CI: `pnpm dlx @shadscan/cli@0.1.0 --fail-under 80`
- Lockfile-managed CI: install with
  `npm install --save-dev @shadscan/cli` or `pnpm add --save-dev @shadscan/cli`,
  then run the installed `shadscan` binary through a package script or
  `pnpm exec shadscan`.

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
