# Shadscan CLI

Audit a React shadcn app for missing UI fundamentals.

```bash
pnpm dlx shadscan
```

Useful flags:

- `--json` prints a machine-readable report.
- `--fail-under <score>` exits non-zero when the score is below the threshold.
- `--category <category>` runs one category.
- `--no-roast` keeps human output neutral.
- `--roast` includes roast copy in JSON or CI output.

Every report includes an agent handoff with suggested skills, context, and
prioritized actionables. JSON consumers can read this from `agentHandoff`.

The first release is read-only. It does not edit project files.
