# Shadscan CLI

Audit a React shadcn app for missing UI fundamentals.

```bash
pnpm dlx shadscan
```

Useful flags:

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
pnpm dlx shadscan --prompt
```

Prompt output is deterministic, neutral, repository-relative Markdown. It asks
the agent to verify evidence, fix P0/P1 findings, review P2 advisories, run the
project's checks, and rescan with the same ruleset.

The first release is read-only. It does not edit project files.
