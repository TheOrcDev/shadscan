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
pnpm audit:self
pnpm --filter shadscan pack --dry-run
```

The package is not published yet. Choose and add a real license before publishing publicly.
