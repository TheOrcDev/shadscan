# Shadscan CLI

Audit a React shadcn app for missing UI fundamentals.

The npm package is not published yet. From a checkout of the repository:

```bash
pnpm install
pnpm cli:build
node packages/cli/dist/cli.js /path/to/shadcn-app
```

Useful flags:

- `[path]` selects the project directory; it defaults to the current directory.
- `--format human|json|prompt` selects one clean output format.
- `--prompt` prints only a paste-ready prompt for an AI coding agent.
- `--json` remains an alias for `--format json`.
- `--fail-under <score>` exits non-zero when the score is below the threshold.
- `--category <category>` runs one category.
- `--no-roast` keeps human output neutral.
- `--roast` includes roast copy in JSON or CI output.

Every report includes an agent handoff with suggested skills, context, and
prioritized actionables. JSON consumers can read this from `agentHandoff`.

To hand the audit directly to an agent:

```bash
node packages/cli/dist/cli.js /path/to/shadcn-app --prompt
```

Prompt output is deterministic, neutral, repository-relative Markdown. It asks
the agent to verify evidence, fix P0/P1 findings, review P2 advisories, run the
project's checks, and rescan with the same ruleset.

## Contracts

- Audit JSON uses schema version `2` and is validated by the exported
  `AuditReportSchema`.
- Agent prompt output uses prompt version `1`.
- Reports identify the exact bundled ruleset version that produced them.
- `RULE_CATALOG` exposes immutable rule metadata without exposing the internal
  custom-rule runner.
- The full generated catalog lives at
  <https://github.com/TheOrcDev/headless-shadcn/blob/main/docs/rules.md>.

The first release is read-only. It does not edit project files.
