<a href="https://www.shadscan.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/header/grid.svg?title=shadscan&amp;subtitle=The%20deterministic%20UI%20audit%20for%20shadcn%20apps&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmIiBzdHJva2UtbGluZWNhcD0ic3F1YXJlIiBzdHJva2UtbGluZWpvaW49Im1pdGVyIiBzdHJva2Utd2lkdGg9IjYiPjxwYXRoIGQ9Ik0yMyAxMUgxMXYxMiBNNDEgMTFoMTJ2MTIgTTExIDQxdjEyaDEyIE01MyA0MXYxMkg0MSIvPjxwYXRoIGQ9Ik0yMiA0MWwxOS0xOSBNMzUgNDNsOC04IiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgzLjQgMy40KSBzY2FsZSguODY0KSIvPjwvc3ZnPg%3D%3D&amp;mode=dark&amp;font=geist-mono&amp;radius=8&amp;watermark=false">
    <img alt="shadscan - The deterministic UI audit for shadcn apps" src="https://shieldcn.dev/header/grid.svg?title=shadscan&amp;subtitle=The%20deterministic%20UI%20audit%20for%20shadcn%20apps&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDkwOTBiIiBzdHJva2UtbGluZWNhcD0ic3F1YXJlIiBzdHJva2UtbGluZWpvaW49Im1pdGVyIiBzdHJva2Utd2lkdGg9IjYiPjxwYXRoIGQ9Ik0yMyAxMUgxMXYxMiBNNDEgMTFoMTJ2MTIgTTExIDQxdjEyaDEyIE01MyA0MXYxMkg0MSIvPjxwYXRoIGQ9Ik0yMiA0MWwxOS0xOSBNMzUgNDNsOC04IiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgzLjQgMy40KSBzY2FsZSguODY0KSIvPjwvc3ZnPg%3D%3D&amp;mode=light&amp;font=geist-mono&amp;radius=8&amp;watermark=false" width="100%">
  </picture>
</a>

<p align="center">
  <a href="https://www.npmjs.com/package/@shadscan/cli"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/npm/@shadscan/cli.svg?mode=dark"><img alt="npm version" src="https://shieldcn.dev/npm/@shadscan/cli.svg?mode=light"></picture></a>
  <a href="https://www.npmjs.com/package/@shadscan/cli"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/npm/dw/@shadscan/cli.svg?mode=dark"><img alt="npm weekly downloads" src="https://shieldcn.dev/npm/dw/@shadscan/cli.svg?mode=light"></picture></a>
  <a href="https://www.npmjs.com/package/@shadscan/cli"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/npm/node/@shadscan/cli.svg?mode=dark"><img alt="supported Node.js version" src="https://shieldcn.dev/npm/node/@shadscan/cli.svg?mode=light"></picture></a>
  <a href="packages/cli/LICENSE"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/npm/license/@shadscan/cli.svg?mode=dark"><img alt="MIT license" src="https://shieldcn.dev/npm/license/@shadscan/cli.svg?mode=light"></picture></a>
</p>

<p align="center">
  <a href="https://www.shadscan.com">Website</a> ·
  <a href="https://www.shadscan.com/scan">Scan a repository</a> ·
  <a href="https://www.shadscan.com/docs">Docs</a> ·
  <a href="docs/rules.md">59 rules</a> ·
  <a href="https://www.shadscan.com/sponsors">Sponsor</a>
</p>

Shadscan inspects a React shadcn app, scores its UI fundamentals from 0 to 100,
and shows the evidence behind every finding. It catches the product details
that are easy to postpone: command menus, theme shortcuts, route states,
accessible controls, form feedback, metadata, mobile behavior, and more.

The default scan is deterministic and read-only. It does not start the app,
edit files, call an AI model, upload source, or require application secrets.

## Quick Start

Run Shadscan from the root of a project:

```bash
pnpm dlx @shadscan/cli
```

The project path defaults to the current directory. Pass a path to scan another
app:

```bash
pnpm dlx @shadscan/cli ../my-shadcn-app
```

Using npm or Bun:

```bash
npx --yes @shadscan/cli
bunx @shadscan/cli
```

Commands resolve to the latest stable release. Prereleases are published
under the `next` tag (`@shadscan/cli@next`) for early testing.

Every interactive scan ends with a short menu — pick with the arrow keys and
Enter: copy the agent handoff to your clipboard, print it, launch an installed
coding agent, or add a pre-commit score gate. The handoff is highlighted
first, so a single Enter grabs it; press Esc to keep just the score.

## What You Get

```text
Your shadscan score: [###############-] 92/100 (Grade A)
shadscan has entered the chat.

Categories:
  Foundation:           20/20 (100%)
  Interaction:        12.2/20  (61%)
  States:               20/20 (100%)
  Accessibility:        20/20 (100%)
  Forms and Data Entry: 10/10 (100%)
  Production Polish:    10/10 (100%)

Missing: command menu has a Cmd/Ctrl+K shortcut
  Evidence: No complete mounted Cmd/Ctrl+K command-menu shortcut was found.
  Fix: Register a shortcut that prevents the browser default and toggles the menu.
```

Every report separates:

- **Fixes**: high-confidence defects with repository-relative evidence.
- **Decisions**: product choices that should be implemented or explicitly waived.
- **Advisories**: lower-confidence checks that need rendered or manual verification.
- **Not applicable**: rules excluded because the relevant UI surface is absent.

## Common Commands

```bash
# Machine-readable, versioned report
pnpm dlx @shadscan/cli --json

# Paste-ready remediation plan for a coding agent
pnpm dlx @shadscan/cli --prompt

# Explicitly launch an installed agent with the generated plan
pnpm dlx @shadscan/cli --apply --agent codex

# Fail CI when the complete assessed score is below the floor
pnpm dlx @shadscan/cli@0.4.0 --fail-under 80 --no-interactive --no-roast

# Audit one category while investigating a focused area
pnpm dlx @shadscan/cli --category accessibility
```

Use `--format human`, `--format json`, or `--format prompt` when output selection
needs to be explicit. Pin an exact package version in CI; unqualified commands
resolve to the latest stable release. Run `pnpm dlx @shadscan/cli --help` for
every option.

## GitHub Action

The repository doubles as a composite GitHub Action that runs the CLI, writes
the score to the job summary, enforces an optional score floor, and can create
or update a tracked issue containing the findings and a paste-ready AI-agent
remediation handoff.

```yaml
name: shadscan
on:
  push:
    branches: [main]

permissions:
  contents: read
  issues: write # only needed with create-issue

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: TheOrcDev/shadscan@main
        with:
          path: .
          version: 0.4.0 # pin an exact CLI version in CI
          fail-under: "80"
          create-issue: "true"
```

Inputs: `path`, `version`, `category`, `fail-under`, `create-issue`,
`issue-label`, and `github-token`. Outputs: `score`, `grade`, and
`report-path` (the machine-readable JSON report). With `create-issue`, the
action keeps a single open issue per label up to date instead of filing a new
issue on every run, and the issue body embeds the same `--prompt` handoff you
would generate locally — ready to paste into a coding agent.

## Agent Handoff

`--prompt` turns the same deterministic report into a neutral, paste-ready plan
for another coding agent. The handoff includes:

- prioritized work items grouped as `fix`, `decide`, or `verify`;
- rule IDs, evidence, suggested fixes, and acceptance criteria;
- detected framework, package manager, and source-coverage context;
- repository-owned verification commands that the agent must inspect first;
- the exact pinned Shadscan command to rescan after the work.

`--apply` is an explicit local action. It validates an installed Claude Code,
Codex CLI, or Grok Build executable before launching it. Shadscan itself still
does not make an AI request; the selected external agent follows its own
provider and approval model.

## What It Checks

The bundled ruleset contains 59 deterministic checks across six weighted
categories.

| Category | Examples |
| --- | --- |
| Foundation | shadcn config, mounted theme provider, metadata, favicon, not-found and error boundaries |
| Interaction | dark-mode and command-menu shortcuts, safe global hotkeys, mobile navigation, focus visibility |
| States | loading and Suspense fallbacks, empty states, retryable errors, pending actions, mounted toasts |
| Accessibility | names and labels, semantic controls, alt text, landmarks, live regions, keyboard and focus behavior |
| Forms and Data Entry | validation, rendered field errors, error associations, legends, button types, autocomplete |
| Production Polish | complete metadata, social previews, Button icon spacing, responsive shells, SEO files, mobile overflow |

See the generated [rule catalog](docs/rules.md) for every rule ID, confidence
level, score behavior, and supported adapter.

## Scoring

Raw rule points are normalized within each weighted category to produce the
100-point score. High- and medium-confidence failures can reduce the score.
Low-confidence checks stay visible as score-neutral advisories instead of
pretending static analysis can prove rendered behavior.

Rules only run where they apply. Shadscan supports Next.js App Router, Pages
Router, hybrid Next.js projects, React Router framework mode, TanStack Start,
Laravel with Inertia and React, Astro with React islands, Vite React, and
generic React applications.

## Web Scanner And Hosted API

The [web scanner](https://www.shadscan.com/scan) audits a public GitHub
repository without installing the CLI or exposing an API key to the browser.
GitHub access, extraction, rate limiting, and scanning stay on the server.

For agent and service integrations, Shadscan also exposes a versioned hosted
API for public GitHub repositories and sanitized gzip tar snapshots.

- [Pinned agent instructions](https://www.shadscan.com/agent/v1.md)
- [OpenAPI 3.1 contract](https://www.shadscan.com/openapi.json)
- [Hosted API setup and security](docs/hosted-api.md)
- [Web scanner architecture and deployment](docs/web-scanner.md)

The hosted surfaces are opt-in and have separate source-handling contracts from
the local CLI.

## Develop Shadscan

Repository development uses Node.js 24 and pnpm 11.15.1. The published CLI has
a Node.js 18 compatibility floor.

```bash
pnpm install
pnpm cli:test
pnpm test:api
pnpm test:web
pnpm exec playwright install chromium
pnpm test:e2e
pnpm docs:check
pnpm check
pnpm typecheck
pnpm build
```

The product site and its own dogfood target live at the repository root. The
published CLI lives in [`packages/cli`](packages/cli).

## Project Docs

| Document | Purpose |
| --- | --- |
| [Contributing guide](CONTRIBUTING.md) | Development setup, repository map, tests, documentation, and pull requests |
| [CLI contract](docs/cli-contract.md) | Invocation, output, exit status, stability, privacy, and security guarantees |
| [Rule catalog](docs/rules.md) | All bundled checks and their scoring behavior |
| [Hosted API](docs/hosted-api.md) | Authentication, request formats, deployment, and source handling |
| [Web scanner](docs/web-scanner.md) | Public scan flow, limits, runtime boundaries, and verification |
| [Release guide](docs/releasing.md) | Candidate, stable, trusted-publishing, and recovery procedures |
| [Security policy](SECURITY.md) | Supported versions and vulnerability reporting |

The Shadscan CLI is available under the
[MIT License](packages/cli/LICENSE). The header and badges are rendered by
[shieldcn](https://shieldcn.dev), a shadcn-styled badge and README graphics
service.
