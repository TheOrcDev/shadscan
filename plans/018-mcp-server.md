# Plan 018: An MCP server inside the CLI

> **Executor instructions**: This plan adds `shadscan mcp` — a stdio MCP
> server so coding agents can query audit results as typed tool calls
> instead of parsing a 59-finding dump. It ships inside `@shadscan/cli`
> (no new package), re-scans on every call (never caches), and is
> read-only by construction. It changes the CLI's public API (new
> exports) but **not** the report schema or any rule; it ships as the
> next minor. Docs are a phase of their own with named deliverables, not
> an afterthought. Update `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `grep -rn "mcp" packages/cli/src/cli.ts packages/cli/package.json`
> If an mcp subcommand exists, reconcile against what shipped.

## Status

- **State**: PLANNED
- **Priority**: P1 — requested by a user, and it opens shadscan to agents
  that cannot run arbitrary shell commands at all.
- **Effort**: L
- **Risk**: MEDIUM. The protocol work is small; the two real hazards are
  the dependency (the MCP SDK drags an HTTP stack the CLI must not ship)
  and stdout discipline (JSON-RPC owns stdout; one stray write corrupts
  the session).
- **Depends on**: none (0.8.0's publish state does not block this)
- **Category**: cli/feature
- **Planned at**: 2026-08-05

## Why build it — and why NOT the reason that prompted it

The requesting user's framing was "the agent could query what's still
broken instead of re-scanning every time." That premise was measured and
does not hold: a scan of this repository takes **~900ms**, and shadscan
is deterministic over *file state* — the moment an agent edits a file,
any cached answer is wrong, precisely when the agent most needs truth. A
server that answered "what's still broken" from memory would confidently
report stale failures.

The real wins are different:

1. **Context economy.** An agent fixing accessibility in `apps/web`
   wants three typed actionables, not a 59-rule report to parse and
   carry in context. Filtered, structured responses are the product.
2. **Distribution.** Agents without shell access (or without approval to
   run `npx`) cannot use shadscan today. MCP is the only door in.
3. **The loop.** Fix → call `scan` → see the delta. Cheap because scans
   are cheap; correct because every call re-scans.

Therefore the design law: **every tool call runs a fresh scan. The
server holds no result state.** "Incremental scanning" (what changed
from these three files) would be genuinely faster *and* correct, but it
is an engine project — the render graph makes one edited component
invalidate every surface that renders it — and is explicitly out of
scope here.

## Current State (verified 2026-08-05)

- The CLI's public API (`packages/cli/src/index.ts`) already exports
  `scanProject`, `AuditReportSchema`, `RULE_CATALOG` (id, title,
  description, category, adapters, confidence per rule), and every type
  the server needs. **`scanWorkspace` and `discoverWorkspace` are not
  exported yet** — the mcp subcommand imports internally, but exporting
  them is part of this plan so the API tells the truth.
- `agentHandoff.actionables` already carries the ideal response shape:
  `disposition`, `priority`, `scoreImpact`, `packageDir`,
  `suggestedFix`, `acceptanceCriteria`, `evidence`.
- Scan timings, measured: ~900ms (this repo), ~3s (`shadcn-ui/ui`, 11
  apps), ~23s (`dub`'s `apps/web`). Re-scan-per-call is viable; the
  worst case informs the timeout guidance in docs.
- **`@modelcontextprotocol/sdk@1.30.0` dependencies, inspected**: ajv,
  cors, **express**, **hono**, jose, eventsource, express-rate-limit,
  and more — an HTTP server stack serving its streamable-HTTP transport,
  which this stdio-only server never uses.
- The CLI ships exactly six runtime dependencies, and `tsup.config.ts`
  already bundles `commander` via `noExternal` as a devDependency — the
  exact precedent to follow.
- The 0.8.0 progress checklist writes to stderr and disables itself on
  non-TTY streams; under MCP, stdout is protocol and stderr is visible
  to the client as log noise, so the mcp path must not enable it.

## Scope decision (read this first)

### Inside the CLI, not a new package

A separate `@shadscan/mcp` would mean a second publish pipeline, a
second version to pin, a second entry in the release runbook, and a
"which version of the CLI does my MCP server match" question forever.
`shadscan mcp` means users who have the CLI already have the server, and
one version describes both. Client configs point at the same package:
`npx -y @shadscan/cli mcp`.

### The SDK is bundled, never a runtime dependency

Adding the MCP SDK to `dependencies` would put express/hono/jose into
every `npx @shadscan/cli` install — unacceptable against the six-dep
discipline. Instead:

1. Add `@modelcontextprotocol/sdk` to **devDependencies**, import only
   the stdio server entry points, and add it to `noExternal` so tsup
   bundles the used modules.
2. **Audit the emitted bundle** (this is a hard gate, not a hope): grep
   `dist/cli.js` for `express`, `hono`, `jose`, `cors` — none may
   appear; record the size delta of `dist/cli.js` in the PR (current:
   ~768KB) and treat more than ~300KB of growth as a stop-and-report.
3. **Fallback if the audit fails**: the stdio surface actually needed —
   `initialize`, `tools/list`, `tools/call`, JSON-RPC 2.0 framing over
   newline-delimited stdio — is small enough to hand-roll against the
   spec. Prefer the SDK for protocol-drift safety; hand-roll only if
   bundling drags the HTTP stack in.

### Three tools, no more

| Tool | Maps to | Returns |
|---|---|---|
| `scan` | `scanProject` / `scanWorkspace` | score, grade, and **actionables** (fail + advisory), filterable |
| `list_projects` | `discoverWorkspace` | packages, kinds, classification reasons, skips — `--list-projects` as a tool |
| `explain_rule` | `RULE_CATALOG` | one rule's title, description, category, adapters, confidence |

`scan` input: `{ path?, category?, severity?, packageDir?, full? }`.
The default response is the *compact* view — score, grade, counts, and
actionables with `findingId`, `title`, `priority`, `scoreImpact`,
`packageDir`, `suggestedFix`, and first evidence location. `full: true`
returns complete findings for the (rare) agent that wants all 59.
Every response carries `rulesetVersion`, `engineVersion`, and
`schemaVersion`, because two agents comparing results across versions
deserve to know they differ.

**Deliberately absent**: any fix/write tool (read-only is a security
property worth advertising, not a gap), any caching tool, any
"remaining work" state, prompts/resources (tools only, first release).

### Security posture

- **Roots are fixed at launch**: `shadscan mcp [path...]` (default: the
  launch cwd). Tool calls with a `path` outside every root are rejected
  with a stable error — reuse the `filesystemRoot` boundary the scanner
  already enforces, do not invent a second check.
- Read-only; no shell, no network, no file writes.
- `stripRoasts` on all MCP output — an agent quoting a roast into a
  commit message is nobody's good day.
- Evidence paths stay project-relative (already guaranteed by
  `normalizeFindingPaths`); the server must not leak absolute scanner
  paths in errors either — match the CLI's existing redacted-error
  discipline in `cli-error.ts`.

### Schema-consumer cost, stated

This makes MCP the **fourth** consumer of the report shape (CLI, hosted
API, GitHub Action, MCP). Mitigation: MCP responses are derived
*subsets* validated by their own zod schemas at the boundary, so a
future schema bump fails loudly in one file (`mcp-contracts.ts`) rather
than silently changing tool output.

## Phase 1 — Transport, `scan` tool, stdout discipline

1. `packages/cli/src/mcp/server.ts` (server wiring + stdio transport)
   and `packages/cli/src/mcp/tools.ts` (tool handlers, pure functions
   over the public scan API). Register `mcp` as a commander subcommand
   that bypasses `runScanAction` entirely — no progress, no post-scan
   menu, no banner. stdout carries JSON-RPC only; startup diagnostics go
   to stderr once, then silence.
2. `scan` tool with filters, compact/full modes, and the version triplet
   on every response. Workspace-vs-single routing mirrors `cli.ts`
   exactly (lone package at the root → single-package path), by calling
   the same exported functions — not by copying the logic.
3. Export `scanWorkspace` and `discoverWorkspace` from `index.ts`.
4. The bundle audit from the scope decision, wired into `cli:smoke` so
   it cannot regress silently: pack, grep the tarball's `dist/cli.js`
   for the forbidden modules, fail loudly.

**Tests** (vitest, SDK `InMemoryTransport` — no subprocess needed):
initialize handshake; `tools/list` shape; `scan` on a Next fixture
returns actionables and score; `category`/`severity` filters narrow
results; `path` outside the root rejected with the stable message;
`full: true` returns findings; two identical calls return identical
bodies (determinism is the brand — prove it over MCP too).

## Phase 2 — Workspace and rules tools

1. `list_projects` (packages, kinds, kindReasons, skips, truncation —
   the same data `--list-projects` prints).
2. `scan` with `packageDir` filtering pooled results; error message
   names the available `packageDir`s when the filter matches nothing.
3. `explain_rule` from `RULE_CATALOG`; unknown ids return the five
   nearest ids by prefix rather than a bare error, because agents
   habitually guess `kebab-case` names.
4. Response-size guard: compact scan responses over ~50 actionables get
   summarized counts by category plus the top 20 by `scoreImpact`, with
   a note saying so — silent truncation reads as "that's everything."

**Tests**: monorepo fixture (reuse `createWorkspaceFixture`) through
`list_projects` and filtered `scan`; nearest-id suggestions; the size
guard's note appears.

## Phase 3 — Hardening and the packed smoke test

1. A real subprocess smoke: spawn the **packed** CLI (`npm pack` output,
   as `cli:smoke` already does), drive `initialize` → `tools/list` →
   `scan` over actual stdio, assert clean JSON-RPC framing end to end.
   This is the test that catches a stray `console.log` from a dependency
   three levels down, which `InMemoryTransport` never will.
2. Signal handling: SIGINT/SIGTERM exit cleanly mid-scan (the abort
   plumbing from `ScanOptions.signal` already exists — wire it to
   transport close).
3. Concurrent `tools/call` requests: serialize scans (the parsed-file
   caches are per-project and memory-heavy; two simultaneous scans of a
   large repo is an OOM invitation). Document the serialization.

## Phase 4 — Documentation (deliverables, each named)

1. **`docs/mcp.md`** — the runbook. Contents: what the server is and the
   re-scan-every-call contract stated plainly; setup for **Claude Code**
   (`claude mcp add shadscan -- npx -y @shadscan/cli mcp`), **Cursor**,
   **VS Code**, and generic JSON config (command `npx`, args
   `["-y", "@shadscan/cli", "mcp", "<path>"]`); the three tools with
   input/output examples copied from real runs, not invented; the
   security posture (roots, read-only, redacted errors); timeout
   guidance ("large monorepos can take ~30s — raise client timeouts");
   troubleshooting (the #1 will be "path outside root").
2. **`README.md`** — an "MCP server" section after the Agent Handoff
   section: the one-line Claude Code setup, the three tools in a
   sentence each, link to `docs/mcp.md`. Version pins in examples follow
   the existing rule (unqualified `@shadscan/cli`;
   `verify-version-pins.mjs` must stay green).
3. **Site docs page** (`app/docs/page.tsx`): an `#mcp-server` section
   mirroring the README content in the page's voice, added to
   `DOCS_SECTIONS` in `lib/docs-sections.ts` so ⌘K finds it — slotted
   after "Agent skill", which is its natural neighbor.
4. **`docs/cli-contract.md`** — the contract addition: under `mcp`,
   stdout is JSON-RPC exclusively; stderr carries at most one startup
   line and abnormal-exit diagnostics; all other output contracts
   (JSON/human/prompt) unchanged.
5. **`CHANGELOG.md`** — Unreleased → Added, including the user-visible
   sentence about what the server refuses to do (cache, write, roast).
6. **`packages/cli/README.md`** — mirror the root README section (it
   ships in the npm tarball and is what npmjs.com renders).

## Release

Ships as the next **minor** (0.9.0 if 0.8.0 has been published by then;
renumber accordingly if not). No ruleset bump — no rule behavior
changes. No schema bump — the report shape is unchanged; MCP responses
are derived views. Full 14-gate suite; the publish remains owner-held.

## Open Questions / Risks

1. **The bundle audit is the make-or-break.** If tsup cannot keep
   express/hono out of `dist/cli.js`, fall back to hand-rolled stdio
   JSON-RPC rather than shipping an HTTP stack to every CLI user. Do not
   soften this into "acceptable for now."
2. **SDK protocol churn.** MCP is young; pin the SDK exactly (the repo
   pins everything exactly already) and record the protocol version the
   server advertises in `docs/mcp.md`.
3. **Long scans vs client timeouts.** `dub` took 23s; some MCP clients
   default to 30–60s tool timeouts. Documented, plus the serialized-scan
   note; if it bites in practice, MCP progress notifications are the
   follow-up, not pre-built complexity.
4. **Per-call cost on giant repos.** Re-scan-per-call is a deliberate
   correctness choice; if a real user hits pain, the fix is incremental
   scanning (its own engine plan), not MCP-side caching. This plan's
   answer must stay "correct and 1–30s", never "instant and stale."
5. **Tool naming collisions.** `scan` is generic; clients namespace by
   server (`shadscan.scan`), so keep the short names.
