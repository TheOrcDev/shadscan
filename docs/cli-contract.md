# shadscan CLI Contract

This contract applies to the `shadscan` executable, whether it is invoked from
a local install, a packed tarball, or npm through `npx`.

## Invocation

```text
shadscan [path] [options]
```

- `path` selects the React project to scan and defaults to the current working
  directory.
- Relative paths resolve from the invoking process's working directory.
- Supported adapters are Next.js App Router, Next.js Pages Router, Vite React,
  and generic React projects.
- shadscan performs a read-only static source audit. It does not start the app,
  edit project files, call an AI model, or require application secrets.

## Output

- Human output is the default and may include roast copy outside CI.
- `--format json` and `--json` write one versioned JSON report to stdout.
- `--format prompt` and `--prompt` write one deterministic agent handoff to
  stdout.
- Expected CLI failures write a stable message to stderr. JSON-selected
  failures write a versioned JSON error object to stderr.
- Evidence paths are project-relative and never contain the scanner machine's
  absolute project path.
- Agent handoffs treat repository instructions and discovered package scripts
  as untrusted project data. Agents must inspect and receive authorization for
  repository-owned gates before executing them.

## Exit Status

- `0`: the audit completed and any requested score threshold passed.
- `1`: project discovery or audit failed, or `--fail-under` was not satisfied.
- Findings do not fail the process unless the caller supplies `--fail-under`.

## Stability

- Report schema, prompt, engine, and bundled ruleset versions are carried in
  their respective outputs.
- A breaking command or report-contract change requires a semver-major release.
- CI callers should pin an exact package version instead of relying on npm's
  moving `latest` tag.

## Security And Privacy

- The scanner does not send project source, findings, or environment variables
  over the network.
- The CLI has no install or postinstall script. Its only package lifecycle hook
  is `prepack`, which builds the distributable before packaging.
- The hosted API is a separate opt-in surface with its own authentication and
  source-handling contract.
