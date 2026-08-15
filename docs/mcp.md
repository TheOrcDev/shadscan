# The shadscan MCP server

`shadscan mcp` serves shadscan over the Model Context Protocol on stdio, so
coding agents can query audit results as typed tool calls instead of parsing
CLI output. It ships inside `@shadscan/cli` — there is no separate package,
and the server version is always the CLI version.

## The contract: every call re-scans

The server holds no result state. Every `scan` call reads the project as it
is on disk at that moment; nothing is cached between calls. shadscan is
deterministic over file state, so the moment an agent edits a file any cached
answer would be wrong — precisely when the agent most needs the truth. Scans
cost roughly one second on a typical project (large monorepos can take
~30 seconds), which buys correctness on every call.

The loop this enables: fix something, call `scan` again, read the delta.

## Setup

The server takes root directories as arguments; tool calls may only scan
inside them. With no arguments it serves the directory it was launched in.

### Claude Code

```bash
claude mcp add shadscan -- npx -y @shadscan/cli mcp
```

### Cursor

Settings → MCP → Add new server, or `.cursor/mcp.json` in the project:

```json
{
  "mcpServers": {
    "shadscan": {
      "command": "npx",
      "args": ["-y", "@shadscan/cli", "mcp"]
    }
  }
}
```

### VS Code

`.vscode/mcp.json` in the workspace:

```json
{
  "servers": {
    "shadscan": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@shadscan/cli", "mcp"]
    }
  }
}
```

### Any other MCP client

Command `npx`, arguments `["-y", "@shadscan/cli", "mcp", "<root>"]`,
transport stdio. The server speaks MCP protocol revision `2025-06-18` and
newer (SDK-negotiated). In CI, pin an exact version
(`@shadscan/cli@<version>`) the same way you would for the CLI.

## Tools

### `scan`

Audits a project and returns its score plus actionable findings. Re-scans on
every call.

| Input | Type | Meaning |
|---|---|---|
| `path` | string? | Directory to scan, relative to the first root. Default: the first root. |
| `category` | enum? | One audit category (`foundation`, `interaction`, `states`, `accessibility`, `forms`, `production-polish`). |
| `severity` | enum? | `error` or `warning`. |
| `packageDir` | string? | One workspace package (monorepos). Unknown values fail with the list of valid ones. |
| `full` | boolean? | Include the complete findings array, not just actionables. |

The compact response (default) carries the score, grade, per-category
counts, and actionables — each with `findingId`, `priority`, `scoreImpact`,
`suggestedFix`, `acceptanceCriteria`, and its first evidence location. When
more than 50 actionables match, the response keeps the 20 with the highest
score impact and says so in `actionablesNote` — the server never truncates
silently.

A real filtered response, trimmed to one actionable:

```json
{
  "engineVersion": "0.8.0",
  "rulesetVersion": "2026.07.41",
  "schemaVersion": 10,
  "actionables": [
    {
      "findingId": "theme-provider-configured",
      "title": "Fix theme provider configured",
      "priority": "P1",
      "scoreImpact": 5,
      "severity": "warning",
      "status": "fail",
      "packageDir": "apps/web",
      "suggestedFix": "Mount a theme provider near the app shell and connect it to the dark-mode class.",
      "evidence": { "message": "No theme provider or theme management was found." }
    }
  ],
  "actionablesNote": null,
  "countsByCategory": { "foundation": 7 },
  "grade": "F",
  "score": 36,
  "workspace": { "applicationCount": 2, "kind": "pnpm", "skippedCount": 1 }
}
```

Every response carries `engineVersion`, `rulesetVersion`, and
`schemaVersion`, so results from different shadscan versions are never
silently compared.

### `list_projects`

Lists the packages shadscan can audit under a workspace root, each
classified as an `application` or a `library` with the reason. Call it
before `scan` on a monorepo to learn the valid `packageDir` values.

### `explain_rule`

Explains one rule: what it checks, its category, which framework adapters it
applies to, and its confidence. Rule ids come from scan results as
`findingId`; unknown ids answer with the nearest matching ids, since agents
habitually guess kebab-case names.

## Security posture

- **Roots are fixed at launch.** `shadscan mcp <path> [path...]` — tool
  calls cannot widen them, and out-of-root paths fail with a stable message
  naming the allowed roots.
- **Read-only.** The server scans; it never writes files, runs package
  scripts, or touches the network.
- **Neutral output.** Roast copy is stripped from all MCP responses.
- **Redacted errors.** Unexpected failures return a generic message rather
  than scanner filesystem detail, matching the CLI's error contract.

## Operational notes

- **Scans are serialized.** Concurrent `scan` calls queue rather than run in
  parallel; two simultaneous scans of a large repository would compete for
  memory, not finish faster.
- **Client timeouts.** A large monorepo can take ~30 seconds; if your client
  defaults to a short tool timeout, raise it for this server.
- **stdout is protocol.** The server prints exactly one startup line to
  stderr and keeps stdout pure JSON-RPC. If you see anything else on stdout,
  that is a bug — please report it.

## Troubleshooting

- **"Path is outside the allowed roots"** — the most common error. Start the
  server with the directory you want scanned:
  `npx -y @shadscan/cli mcp /path/to/repo`, or add more roots as extra
  arguments.
- **"The nearest package does not declare React"** — the scanned directory
  is not a React project. On a monorepo, scan the workspace root (shadscan
  pools every application) or pass `packageDir`.
- **Slow first call** — `npx -y` downloads the package on first use; pin and
  pre-install `@shadscan/cli` where startup latency matters.
