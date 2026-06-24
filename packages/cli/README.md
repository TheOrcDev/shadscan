# Headless Shadcn CLI

Audit a React shadcn app for missing UI fundamentals.

```bash
pnpm dlx headless-shadcn
```

Useful flags:

- `--json` prints a machine-readable report.
- `--fail-under <score>` exits non-zero when the score is below the threshold.
- `--category <category>` runs one category.
- `--no-roast` keeps human output neutral.
- `--roast` includes roast copy in JSON or CI output.

The first release is read-only. It does not edit project files.
