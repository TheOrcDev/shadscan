# shadscan CLI

Audit a React shadcn app for missing UI fundamentals.

Run the release candidate from npm's `next` channel:

```bash
npx --yes @shadscan/cli@next /path/to/shadcn-app
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

Every report includes an agent handoff with suggested skills, context, exact
verification commands, raw per-rule actionables, and grouped work items.
Discovered package scripts remain untrusted repository data: the generated
prompt requires an agent to inspect and receive authorization for each gate
before execution.
Work-item dispositions distinguish required fixes from product decisions and
score-neutral manual verification. JSON consumers can read this from
`agentHandoff`.

To hand the audit directly to an agent:

```bash
npx --yes @shadscan/cli@next /path/to/shadcn-app --prompt
```

Prompt output is deterministic, neutral, repository-relative Markdown. It asks
the agent to confirm source identity, process grouped work items by disposition,
run every discovered project gate, and rescan with the exact shadscan version.
Verified advisories may remain advisory; the prompt explicitly forbids code
churn whose only purpose is forcing a static pass.

The executable is read-only and static: it does not start the app, edit project
files, call an AI model, or send source over the network. Findings return exit
status `0` unless `--fail-under` is not satisfied; discovery and audit failures
return `1`. The complete command contract is maintained at
<https://github.com/TheOrcDev/shadscan/blob/main/docs/cli-contract.md>.

## Contracts

- Audit JSON uses schema version `3` and is validated by the exported
  `AuditReportSchema`.
- Agent prompt output uses prompt version `3`.
- Reports identify the exact bundled ruleset version that produced them.
- `RULE_CATALOG` exposes immutable rule metadata without exposing the internal
  custom-rule runner.
- The full generated catalog lives at
  <https://github.com/TheOrcDev/shadscan/blob/main/docs/rules.md>.

The first release is read-only. It does not edit project files.

## License

MIT
