# shadscan CLI Contract

This contract applies to the `shadscan` executable, whether it is invoked from
a local install, a packed tarball, or npm through `npx`.

## Invocation

```text
shadscan [path] [options]
shadscan setup [path] --pre-commit [--dry-run | --yes]
shadscan --check-ui <url> [--route <path> ...]
```

- `path` selects the React project to scan and defaults to the current working
  directory.
- Repeatable `--ignore <glob>` values exclude matching source paths from the
  audit. They merge with built-in ignores and with `ignore` from
  `shadscan.config.jsonc`, `shadscan.config.json`, or `package.json#shadscan`
  in the scanned package. Negation globs and absolute or parent paths are
  rejected. `--category` and `--project` remain orthogonal filters.
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
- `--check-ui <url>` runs the standalone rendered UI suite. It requires an
  absolute HTTP or HTTPS URL for an already-running local or deployed app and
  does not resolve or discover a project. Horizontal overflow is the suite's
  first check; future deterministic rendered checks can use the same command.
  The supplied URL is always checked; repeatable `--route <path>` values add
  paths that begin with exactly one `/`, up to ten pages in total. Routes
  cannot contain a query string, fragment, or backslash.
- The horizontal-overflow check uses fixed CSS viewports of 320 × 820 (mobile)
  and 1440 × 1000 (desktop), both at device scale factor 1. It fails on any
  document-level horizontal overflow or a horizontal scrollbar forced on the
  root or body. It does not add an audit rule, score, or grade and does not
  change the source audit, bundled rule count, ruleset, or audit schema.
- The initial navigation may follow canonical server redirects. Every URL must
  be credential-free HTTP(S). In addition to exact-origin redirects, the chain
  may contain at most one anchored `www` change for a conventional two-label
  apex host (or localhost) and at most one HTTP-to-HTTPS default-port upgrade.
  Targets under multi-label public suffixes must use their canonical origin
  directly. HTTPS downgrades, other host or port changes, project-subdomain
  aliases, and client-side cross-origin navigations are rejected. Mobile and
  desktop must resolve to the same origin. That resolved origin is pinned, and
  every `--route` path is resolved against it.
- The caller starts or deploys the target app. Shadscan does not run install,
  dev, build, or start scripts for rendered UI mode.
  `--browser-executable <path>` may select a Chromium-family executable
  explicitly.
- Rendered UI mode accepts human or JSON output, `--route`,
  `--browser-executable`, `--no-interactive`, and `--no-roast`. It rejects a
  non-default project path and source-audit-only score, category, prompt, agent,
  project-selection, listing, and positive-roast options. `--route` and
  `--browser-executable` are invalid without `--check-ui`.

## Output

- Human output is the default and may include roast copy outside CI. TTY output
  uses a width-aware Unicode and color score bar; redirected output and CI use
  a deterministic ASCII bar with color disabled by default. `NO_COLOR` always
  wins, while `FORCE_COLOR` can explicitly color the ASCII fallback.
- `--format json` and `--json` write one versioned JSON report to stdout.
  `coverage.ignorePatterns` lists the extra user ignore globs that were
  applied, or an empty array when none were configured.
- `--format prompt` and `--prompt` write one deterministic agent handoff to
  stdout.
- Rendered UI mode supports human output, `--format human`, `--format json`,
  and `--json`. Its current JSON output is a separate versioned
  `overflow-check` report, not an audit report. It contains every requested
  page and viewport measurement, bounded likely-culprit selectors for failures,
  and a summary, but no score, grade, or rule result. `target.origin` is the
  resolved, pinned origin. Human output also identifies the originally
  requested origin when a canonical redirect changed it.
- A detected overflow writes the complete human or JSON report to stdout before
  exiting non-zero. An overflow operational failure leaves stdout empty and
  writes a stable human or versioned JSON error to stderr.
- Expected CLI failures write a stable message to stderr. JSON-selected
  failures write a versioned JSON error object to stderr.
- Interactive human progress, menus, warnings, confirmations, and launched-agent
  status are written to stderr so the completed report on stdout remains
  intact. Progress begins immediately, keeps completed phases visible, and
  depends on stderr terminal capabilities rather than stdin or stdout TTY state.
  Rendered UI checks use `Resolving UI target`, `Checking mobile and desktop
  layouts`, and `Preparing UI report`. JSON, prompt, CI, `TERM=dumb`, non-TTY
  stderr, and `--no-interactive` commands suppress progress.
- Under `shadscan mcp`, stdout carries JSON-RPC exclusively; stderr carries a
  single startup line and abnormal-exit diagnostics. Tool errors return as
  MCP error results with the same stable public messages as CLI failures,
  never as raw stream writes. All other output contracts are unchanged.
- Evidence paths are project-relative and never contain the scanner machine's
  absolute project path.
- Agent handoffs treat repository instructions and discovered package scripts
  as untrusted project data. Agents must inspect and receive authorization for
  repository-owned gates before executing them.
- `--no-interactive` suppresses terminal progress and the default post-scan
  menu. `CI`, a non-TTY stream, or `SHADSCAN_INTERACTIVE=0` also suppresses the
  menu. Pressing Enter in the menu selects `Done` and leaves the project
  unchanged.

## Exit Status

- `0`: the requested scan or setup preview completed, any requested score
  threshold passed, and any launched agent exited successfully.
- `1`: project discovery, audit, setup, or launched-agent execution failed, or
  `--fail-under` was not satisfied.
- Findings do not fail the process unless the caller supplies `--fail-under`.
- Launching an agent never clears an existing score-threshold failure.
- In rendered UI mode, `0` currently means every requested page fit both fixed
  viewports. Detected overflow is a critical failure and exits `1`. Invalid
  arguments, an unavailable browser or target, unsupported response, unstable
  page, timeout, redirect-policy violation, and measurement failure also exit
  `1`.

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
- Rendered UI mode is an explicit network exception: it performs GET
  navigations to the supplied target and requested routes, follows only the
  canonical server redirects defined above, and executes the target's page
  JavaScript in fresh isolated Chromium contexts. It reads no project source,
  invokes no package scripts, persists no cookies between measurements, and
  saves no page data. Query strings and fragments are redacted from reports.
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
- Rendered UI mode is local-CLI-only. It is not exposed by MCP, the GitHub
  Action, hosted API, or web scanner.
