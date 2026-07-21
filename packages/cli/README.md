# shadscan CLI

Audit a React shadcn app for missing UI fundamentals.

Supports Next.js App Router, Pages Router, projects using both routers during a
migration, Vite React, and generic React applications.

Requires Node.js 18 or newer.

Run the release candidate from npm's `next` channel:

```bash
npx --yes @shadscan/cli@next /path/to/shadcn-app
```

Useful flags:

- `[path]` selects the project directory; it defaults to the current directory.
- `--format human|json|prompt` selects one clean output format.
- `--prompt` prints only a paste-ready prompt for an AI coding agent.
- `--json` remains an alias for `--format json`.
- `--apply` validates and opens an installed coding-agent CLI with the generated
  remediation prompt.
- `--agent claude|codex|grok` selects the CLI used by `--apply`; without it,
  Shadscan offers the matching candidates found on `PATH` and validates the
  selected provider before launch.
- `--no-interactive` disables all Shadscan follow-up prompts.
- `--fail-under <score>` exits non-zero when the score is below the threshold,
  unassessed, or based on partial source coverage.
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

To launch an installed agent with that prompt immediately:

```bash
npx --yes @shadscan/cli@next /path/to/shadcn-app --apply --agent codex
```

`--apply` is available only in a local interactive terminal, never in CI. It
resolves the executable from `PATH`, rejects project-local binaries, checks its
identity with `--version`, and passes an argument array without constructing a
user-controlled shell command or adding approval-bypass flags. The agent may
read and edit files, run commands, and send prompt data to its provider. Agent
failures preserve a non-zero exit status, and an existing `--fail-under`
failure remains a failure even when the agent succeeds.

Prompt output is deterministic, neutral, repository-relative Markdown. It asks
the agent to confirm source identity, process grouped work items by disposition,
run every discovered project gate, and rescan with the exact shadscan version.
Verified advisories may remain advisory; the prompt explicitly forbids code
churn whose only purpose is forcing a static pass.

The default scan is read-only and static: it does not start the app, edit
project files, call an AI model, or send source over the network. In a local
TTY, its follow-up menu can explicitly launch an external agent or preview a
pre-commit score gate; pressing Enter selects `Done`. Use `--no-interactive`
for deterministic local automation. Findings return exit status `0` unless
`--fail-under` is not satisfied; discovery, audit, setup, and launched-agent
failures return `1`.

## Pre-commit score gate

When no active blocking Shadscan hook is detected, an interactive human scan
offers to add one. Shadscan shows the exact pinned command and affected path,
then asks for confirmation before writing. Existing hooks are never executed.
Category-scoped scans do not offer a hook because their score is not comparable
to the generated full-project gate.
Simple native Git hooks using POSIX `sh` or `dash` can be extended
automatically. Husky, Lefthook, simple-git-hooks, pre-commit, conflicting
managers, other shell interpreters, and opaque native hooks receive manual
integration instructions instead so their dispatch semantics can be reviewed
explicitly.

Preview or install it explicitly:

```bash
shadscan setup --pre-commit --dry-run
shadscan setup --pre-commit --yes
```

The floor is the current complete assessed score, and the generated hook pins
the exact Shadscan version. This project hook is distinct from the optional
`shadscan-pre-commit` agent skill: the skill governs agent commit behavior but
does not install a Git hook.

## Contracts

- Audit JSON uses schema version `4` and is validated by the exported
  `AuditReportSchema`.
- Agent prompt output uses prompt version `5`.
- Reports identify the exact bundled ruleset version that produced them.
- `RULE_CATALOG` exposes immutable rule metadata without exposing the internal
  custom-rule runner.
- The exported `RULE_CATALOG` contains every bundled rule's immutable metadata.

## License

MIT
