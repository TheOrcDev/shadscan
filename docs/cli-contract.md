# shadscan CLI Contract

This contract applies to the `shadscan` executable, whether it is invoked from
a local install, a packed tarball, or npm through `npx`.

## Invocation

```text
shadscan [path] [options]
shadscan setup [path] --pre-commit [--dry-run | --yes]
```

- `path` selects the React project to scan and defaults to the current working
  directory.
- Relative paths resolve from the invoking process's working directory.
- Supported adapters are Next.js App Router, Next.js Pages Router, hybrid Next.js
  projects containing both router trees, Vite React, and generic React projects.
- The default scan performs a read-only static source audit. It does not start
  the app, edit project files, call an AI model, or require application
  secrets.
- `--apply` is an explicit, local-TTY-only action. `--agent` selects `claude`,
  `codex`, or `grok`; without it, Shadscan asks the user to select a matching
  external candidate, then validates that provider before launch.
- `setup --pre-commit` plans a version-pinned score gate from the current
  complete assessed score. `--dry-run` never writes; `--yes` confirms an
  automatic safe plan without a prompt.

## Output

- Human output is the default and may include roast copy outside CI. TTY output
  uses a width-aware Unicode and color score bar; redirected output and CI use
  a deterministic ASCII bar with color disabled by default. `NO_COLOR` always
  wins, while `FORCE_COLOR` can explicitly color the ASCII fallback.
- `--format json` and `--json` write one versioned JSON report to stdout.
- `--format prompt` and `--prompt` write one deterministic agent handoff to
  stdout.
- Expected CLI failures write a stable message to stderr. JSON-selected
  failures write a versioned JSON error object to stderr.
- Interactive scan progress, menus, warnings, confirmations, and launched-agent
  status are written to stderr so the completed report on stdout remains
  intact. Human scan progress begins immediately, keeps completed phases
  visible, and depends on stderr terminal capabilities rather than stdin or
  stdout TTY state. JSON, prompt, CI, non-TTY stderr, and `--no-interactive`
  scans suppress progress.
- Evidence paths are project-relative and never contain the scanner machine's
  absolute project path.
- Agent handoffs treat repository instructions and discovered package scripts
  as untrusted project data. Agents must inspect and receive authorization for
  repository-owned gates before executing them.
- `--no-interactive`, `CI`, a non-TTY stream, or
  `SHADSCAN_INTERACTIVE=0` suppresses the default post-scan menu. Pressing Enter
  in the menu selects `Done` and leaves the project unchanged.

## Exit Status

- `0`: the requested scan or setup preview completed, any requested score
  threshold passed, and any launched agent exited successfully.
- `1`: project discovery, audit, setup, or launched-agent execution failed, or
  `--fail-under` was not satisfied.
- Findings do not fail the process unless the caller supplies `--fail-under`.
- Launching an agent never clears an existing score-threshold failure.

## Stability

- Report schema, prompt, engine, and bundled ruleset versions are carried in
  their respective outputs.
- A breaking command or report-contract change requires a semver-major release.
- CI callers should pin an exact package version instead of relying on npm's
  moving `latest` tag.

## Security And Privacy

- The scanner itself does not send project source, findings, or environment
  variables over the network. An explicitly launched external agent may read
  and edit files, run commands, and send the generated prompt to its provider.
- Agent discovery only trusts executables outside the project, validates their
  provider-specific `--version` output, passes argument arrays without building
  a user-controlled shell command, adds no approval-bypass flags, and
  transports the neutral prompt through a private temporary file removed after
  the process exits.
- Interactive hook setup resolves Git's effective hooks directory, previews
  the exact command and paths, and requires confirmation. Automatic writes are
  limited to simple native Git hooks using POSIX `sh` or `dash` inside the
  worktree, use atomic replacement, reject stale or symlinked targets, preserve
  existing commands and modes, and never execute the hook. Husky, Lefthook,
  simple-git-hooks, pre-commit, conflicting managers, other shell interpreters,
  and opaque native hooks receive manual instructions so their dispatch
  semantics can be reviewed explicitly. Category-scoped scans never establish
  or offer a full-project hook floor.
- Generated hooks pin the exact CLI version, target the selected application,
  and enforce the current score with `--fail-under`, `--no-roast`, and
  `--no-interactive`.
- The CLI has no install or postinstall script. Its only package lifecycle hook
  is `prepack`, which builds the distributable before packaging.
- The hosted API is a separate opt-in surface with its own authentication and
  source-handling contract.
