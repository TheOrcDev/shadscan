# Shadscan

The CLI that inspects a React shadcn app and tells you what your UI is missing.

If the command menu, theme toggle, keyboard shortcuts, empty states, loading states, error boundaries, toast setup, labels, metadata, and route states are missing, Shadscan scores the app and shows the receipts.

## Usage

```bash
pnpm dlx shadscan
```

CI gate:

```bash
pnpm dlx shadscan --fail-under 80
```

Machine-readable output:

```bash
pnpm dlx shadscan --json
```

Paste-ready agent prompt:

```bash
pnpm dlx shadscan --prompt
```

For explicit output selection, use `--format human`, `--format json`, or
`--format prompt`. Prompt output contains the prioritized handoff and
repository-relative evidence without roast copy or machine-local paths.

Both human and JSON output include an `agentHandoff` section with suggested
skills, context, and prioritized actionables for another agent to pick up.

## Hosted API

An agent can scan without installing or running the CLI in the target project.
Give the agent a `SHADSCAN_API_KEY` environment variable, then send it this
prompt:

```text
Read https://shadscan.dev/agent.md and follow it. Scan this repository,
inspect every cited finding, fix the verified P0 and P1 issues, run the
project's checks, then rescan and summarize the before/after result. Never put
the API key or repository secrets in a prompt, log, archive, or committed file.
```

The hosted API supports public GitHub repositories and sanitized gzip tar
snapshots of the current working tree. A successful JSON response contains the
versioned report and `handoff.promptMarkdown`; request `text/markdown` to receive
only the paste-ready remediation prompt.

- Agent instructions: <https://shadscan.dev/agent.md>
- OpenAPI 3.1 contract: <https://shadscan.dev/openapi.json>
- Scan endpoint: `POST https://shadscan.dev/v1/scans`
- Self-hosting and key setup: [docs/hosted-api.md](docs/hosted-api.md)

## Current Checks

- shadcn `components.json`
- theme provider
- dark-mode keyboard shortcut
- metadata/head basics
- favicon/app icon
- Next `not-found.tsx`
- app error boundary
- toast setup
- icon-only button labels
- non-semantic click targets
- form labels
- dialog/sheet titles

## Local Development

```bash
pnpm install
pnpm cli:test
pnpm cli:build
pnpm test:api
pnpm audit:self
pnpm check
pnpm typecheck
pnpm build
```

The Next app in this repo is the product site and dogfood target. The CLI package lives in `packages/cli`.

## Release Checklist

```bash
pnpm check
pnpm typecheck
pnpm build
pnpm cli:test
pnpm cli:build
pnpm test:api
pnpm audit:self
pnpm cli:pack:dry-run
pnpm cli:smoke
```

The package is not published yet. Choose and add a real license before publishing publicly.
