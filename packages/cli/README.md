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
  <a href="https://www.npmjs.com/package/@shadscan/cli"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/npm/license/@shadscan/cli.svg?mode=dark"><img alt="MIT license" src="https://shieldcn.dev/npm/license/@shadscan/cli.svg?mode=light"></picture></a>
</p>

<p align="center">
  <a href="https://www.shadscan.com">Website</a> &middot;
  <a href="https://www.shadscan.com/scan">Web scanner</a> &middot;
  <a href="https://www.shadscan.com/docs">Docs</a> &middot;
  <a href="https://www.shadscan.com/agent/v1.md">Agent guide</a> &middot;
  <a href="https://www.shadscan.com/sponsors">Sponsor</a>
</p>

Shadscan inspects a React shadcn app, scores its UI fundamentals from 0 to 100,
and gives you evidence and an actionable fix for every finding. It catches the
product details that are easy to postpone: command menus, theme shortcuts,
route states, accessible controls, form feedback, metadata, mobile behavior,
and more.

The default scan is deterministic and read-only. It does not start your app,
edit files, call an AI model, upload source, or require application secrets.

## Quick Start

Run Shadscan from the root of a project:

```bash
npx --yes @shadscan/cli@next
```

Pass a path to scan another project:

```bash
npx --yes @shadscan/cli@next ../my-shadcn-app
```

Using pnpm or Bun:

```bash
pnpm dlx @shadscan/cli@next
bunx @shadscan/cli@next
```

Shadscan requires Node.js 18 or newer. `next` is the current release-candidate
channel.

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

Every report separates required fixes, product decisions, score-neutral
advisories, and rules that do not apply to the scanned project.

## Common Commands

```bash
# Machine-readable, versioned report
npx --yes @shadscan/cli@next --json

# Paste-ready remediation plan for a coding agent
npx --yes @shadscan/cli@next --prompt

# Explicitly launch an installed coding agent with that plan
npx --yes @shadscan/cli@next --apply --agent codex

# Audit one category while investigating a focused area
npx --yes @shadscan/cli@next --category accessibility
```

For a reproducible CI gate, save an exact version in the lockfile and fail when
the complete assessed score falls below your floor:

```bash
npm install --save-dev --save-exact @shadscan/cli@next
npx shadscan --fail-under 80 --no-interactive --no-roast
```

Use `--format human`, `--format json`, or `--format prompt` when output selection
needs to be explicit. Run `npx --yes @shadscan/cli@next --help` for every option.

## Agent Handoff

`--prompt` turns the deterministic report into a neutral, paste-ready plan for
another coding agent. It includes:

- prioritized work items grouped as `fix`, `decide`, or `verify`;
- rule IDs, evidence, suggested fixes, and acceptance criteria;
- detected framework, package manager, and source-coverage context;
- repository-owned verification commands that the agent must inspect first;
- the exact pinned Shadscan command to rescan after the work.

`--apply` is an explicit local action. It validates an installed Claude Code,
Codex CLI, or Grok Build executable before launching it. Shadscan itself still
does not make an AI request; the selected external agent follows its own
provider and approval model.

## Before Every Agent Commit

Install the optional AI-agent commit protocol:

```bash
npx skills add TheOrcDev/skills --skill shadscan-pre-commit --global
```

Then ask your agent:

```text
Use $shadscan-pre-commit for this task. Establish the current score before
editing, run Shadscan immediately before every commit, and do not commit if the
audit is unassessed or below the task floor.
```

The skill governs agent behavior only. It does not install dependencies,
configure Git, or add a Husky or native pre-commit hook.

## What It Checks

The bundled ruleset contains 56 deterministic checks across six weighted
categories.

| Category | Examples |
| --- | --- |
| Foundation | shadcn config, mounted theme provider, metadata, favicon, not-found and error boundaries |
| Interaction | dark-mode and command-menu shortcuts, safe global hotkeys, mobile navigation, focus visibility |
| States | loading and Suspense fallbacks, empty states, retryable errors, pending actions, mounted toasts |
| Accessibility | names and labels, semantic controls, alt text, landmarks, live regions, keyboard and focus behavior |
| Forms and Data Entry | validation, rendered field errors, error associations, legends, button types, autocomplete |
| Production Polish | complete metadata, social previews, Button icon spacing, responsive shells, SEO files, mobile overflow |

Raw rule points are normalized within each category to produce the 100-point
score. High- and medium-confidence failures can reduce it. Low-confidence
checks stay visible as score-neutral advisories instead of pretending static
analysis can prove rendered behavior.

Rules only run where they apply. Shadscan supports Next.js App Router, Pages
Router, hybrid Next.js projects, Vite React, and generic React applications.

## Privacy And Exit Status

Local scanning is static and stays on your machine. Findings return exit status
`0` unless `--fail-under` is not satisfied. Discovery, audit, setup, and
launched-agent failures return `1`. Use `--no-interactive` for deterministic
automation.

The optional [web scanner](https://www.shadscan.com/scan) and
[hosted API](https://www.shadscan.com/openapi.json) accept public GitHub
repositories through separate, documented source-handling contracts.

## Contracts

- Audit JSON uses schema version `4` and is validated by the exported
  `AuditReportSchema`.
- Agent prompt output uses prompt version `5`.
- Every report identifies the exact bundled ruleset version that produced it.
- `RULE_CATALOG` exposes immutable rule metadata for integrations.

## License

Shadscan is available under the MIT License.
