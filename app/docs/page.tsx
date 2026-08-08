import Link from "next/link";
import { CodeBlockCommand } from "@/components/code-block-command";
import { CopyButton } from "@/components/copy-button";
import { DocsOnThisPage } from "@/components/docs-on-this-page";
import { AGENT_AUDIT_PROMPT } from "@/lib/agent-prompt";
import { DOCS_SECTIONS } from "@/lib/docs-sections";
import { createPageMetadata } from "@/lib/site-metadata";

const CLI_PACKAGE = "@shadscan/cli";

const AGENT_PROMPT =
  "Use $shadscan-pre-commit for this task. Establish the current score before editing, run Shadscan immediately before every commit, and do not commit if the audit is unassessed or below the task floor.";

const GITHUB_ACTION_WORKFLOW = `name: shadscan
on:
  push:
    branches: [main]

permissions:
  contents: read
  issues: write # only needed with create-issue

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: TheOrcDev/shadscan@main
        with:
          path: .
          version: 0.11.0 # pin an exact CLI version
          fail-under: "80"
          create-issue: "true"`;

const PROJECT_RULE = `## Shadscan

Before creating any commit, use $shadscan-pre-commit. Establish the current score when work begins, run Shadscan immediately before each commit, and do not commit if the score is unassessed or below the task floor.`;

const CLI_OPTIONS = [
  {
    description:
      "Project directory to scan. Relative paths resolve from the current directory. Defaults to .",
    option: "[path]",
  },
  {
    description:
      "Choose human, json, or prompt output. Human output is the default.",
    option: "--format <format>",
  },
  {
    description:
      "Print only a neutral, paste-ready Markdown prompt for an AI coding agent.",
    option: "--prompt",
  },
  {
    description:
      "Print the complete machine-readable audit report. Alias for --format json.",
    option: "--json",
  },
  {
    description:
      "Validate and open an installed coding-agent CLI with the generated remediation prompt. Local interactive terminals only.",
    option: "--apply",
  },
  {
    description:
      "Choose claude, codex, or grok for --apply. Without it, choose a matching PATH candidate to validate and launch.",
    option: "--agent <agent>",
  },
  {
    description:
      "Exit with status 1 when the score is below an integer from 0 to 100, or is unassessed.",
    option: "--fail-under <score>",
  },
  {
    description: "Run only one audit category.",
    option: "--category <category>",
  },
  {
    description: "Keep human-readable findings neutral.",
    option: "--no-roast",
  },
  {
    description: "Include roast copy in CI or JSON output.",
    option: "--roast",
  },
  {
    description:
      "Disable the local post-scan menu and all Shadscan follow-up prompts.",
    option: "--no-interactive",
  },
  {
    description: "Print command usage and all available options.",
    option: "--help",
  },
  {
    description: "Print the installed Shadscan version.",
    option: "--version",
  },
] as const;

interface DocsCodeBlockProps {
  code: string;
  label: string;
  language: "bash" | "markdown" | "text";
}

const getCliCommands = (cliArguments = "") => {
  const suffix = cliArguments ? ` ${cliArguments}` : "";

  return {
    bun: `bunx ${CLI_PACKAGE}${suffix}`,
    npm: `npx --yes ${CLI_PACKAGE}${suffix}`,
    pnpm: `pnpm dlx ${CLI_PACKAGE}${suffix}`,
    yarn: `yarn dlx --quiet --package ${CLI_PACKAGE} shadscan${suffix}`,
  } as const;
};

function DocsCodeBlock({ code, label, language }: DocsCodeBlockProps) {
  return (
    <div className="not-typeset relative mt-4 overflow-hidden border bg-code">
      <div className="flex h-10 items-center justify-between border-b px-4">
        <span className="font-mono text-muted-foreground text-xs">{label}</span>
        <CopyButton
          aria-label={`Copy ${label}`}
          className="size-7 rounded-none"
          size="icon-sm"
          text={code}
          variant="ghost"
        />
      </div>
      <pre className="whitespace-pre-wrap break-words p-4 text-sm leading-6">
        <code
          className="font-mono text-code-foreground"
          data-language={language}
        >
          {code}
        </code>
      </pre>
    </div>
  );
}

export const metadata = createPageMetadata({
  description:
    "Run Shadscan, inspect a progress-bar score, launch a coding agent, enforce score thresholds, and add a safe pre-commit gate.",
  imageAlt: "Shadscan CLI scoring, agent launch, and pre-commit setup",
  imagePath: "/docs/opengraph-image",
  path: "/docs",
  title: "Shadscan CLI documentation",
});

export default function DocsPage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-16">
      <aside className="hidden lg:block">
        <DocsOnThisPage sections={DOCS_SECTIONS} />
      </aside>

      <article className="typeset min-w-0 max-w-3xl pb-20 [&_section[id]]:scroll-mt-10">
        <header>
          <div className="not-typeset flex items-baseline justify-between gap-4">
            <p className="font-mono text-muted-foreground text-sm">
              CLI documentation
            </p>
            <Link
              className="font-mono text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
              href="/changelog"
            >
              Changelog
            </Link>
          </div>
          <h1>Shadscan CLI</h1>
          <div className="not-typeset mt-5">
            <CodeBlockCommand {...getCliCommands()} />
          </div>
          <p>
            Run this from the root of a React shadcn app. The one-shot command
            needs no project install. Shadscan reads source and configuration,
            prints the audit, and leaves the project unchanged unless you
            explicitly choose a follow-up action.
          </p>
        </header>

        <section id="usage">
          <h2>Usage</h2>
          <DocsCodeBlock
            code="shadscan [path] [options]"
            label="Syntax"
            language="bash"
          />
          <p>
            The optional <code>path</code> defaults to the current directory.
            Pass a relative or absolute path to scan another project.
          </p>
          <h3>Run with an AI agent (recommended)</h3>
          <DocsCodeBlock
            code={AGENT_AUDIT_PROMPT}
            label="Prompt"
            language="text"
          />
          <p>
            The recommended way to start is to hand the audit to your AI coding
            agent. Copy the prompt above and paste it in — it runs Shadscan,
            then, without editing any code, summarizes the findings by severity
            and proposes a prioritized remediation plan for you to approve
            before anything changes.
          </p>
          <h3>Hand the results off to an agent</h3>
          <div className="not-typeset mt-4">
            <CodeBlockCommand {...getCliCommands("--prompt")} />
          </div>
          <p>
            After a scan, <code>--prompt</code> turns the results into a
            paste-ready Markdown handoff: the exact findings with evidence,
            suggested fixes, acceptance criteria, and the rescan command. Paste
            it into Claude Code, Codex, or any coding agent — or skip the paste
            entirely with <code>--apply</code>, which launches an installed
            agent with the same handoff.
          </p>
          <p>
            A handoff works better than a &quot;fix my UI&quot; prompt because
            the agent starts from deterministic evidence instead of
            rediscovering problems: every task is scoped to a real finding, has
            acceptance criteria to meet, and ends with the exact command that
            verifies the fix. The same source always produces the same handoff,
            so agent sessions stay reproducible and reviewable.
          </p>
          <p>To get the most out of a handoff:</p>
          <ul>
            <li>
              Start from a clean working tree, so the agent&apos;s diff contains
              nothing but remediation and stays easy to review.
            </li>
            <li>
              Narrow big audits with <code>--category</code> or a path — one
              focused session per category beats one sprawling session that
              loses context.
            </li>
            <li>
              Have the agent propose a plan before editing, and approve it first
              — the recommended prompt above already insists on this.
            </li>
            <li>
              When the agent says it is done, rescan. The score is the
              acceptance test, and <code>--fail-under</code> makes it a CI gate
              so regressions cannot merge.
            </li>
          </ul>
          <h3>Scan another directory</h3>
          <div className="not-typeset mt-4">
            <CodeBlockCommand {...getCliCommands("../my-shadcn-app")} />
          </div>
          <p>
            The default human report leads with an overall progress bar, then
            includes category scores, evidence, fixes, and agent-ready
            actionables. Local TTYs receive a width-aware Unicode and color bar;
            CI and redirected output receive a deterministic ASCII fallback with
            color disabled by default. <code>NO_COLOR</code> always wins, while{" "}
            <code>FORCE_COLOR</code> can color that fallback. Roast copy is
            enabled for local human output and disabled automatically in CI.
          </p>
        </section>

        <section id="options">
          <h2>Options</h2>
          <dl className="not-typeset mt-5 border-y">
            {CLI_OPTIONS.map(({ description, option }) => (
              <div
                className="grid gap-2 border-b py-4 last:border-b-0 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6"
                key={option}
              >
                <dt>
                  <code className="break-words font-mono text-sm">
                    {option}
                  </code>
                </dt>
                <dd className="text-muted-foreground text-sm leading-6">
                  {description}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Categories are <code>foundation</code>, <code>interaction</code>,{" "}
            <code>states</code>, <code>accessibility</code>, <code>forms</code>,
            and <code>production-polish</code>. The <code>--prompt</code> and{" "}
            <code>--json</code> aliases cannot be combined with each other or
            with <code>--format</code>. <code>--apply</code> requires human
            output, and <code>--agent</code> requires <code>--apply</code>.
          </p>
        </section>

        <section id="agent-prompt">
          <h2>Create an agent prompt</h2>
          <div className="not-typeset mt-4">
            <CodeBlockCommand {...getCliCommands("--prompt")} />
          </div>
          <p>
            <code>--prompt</code> is an alias for <code>--format prompt</code>.
            It prints only neutral Markdown that you can paste into an AI coding
            agent. This output mode does not call an AI model itself.
          </p>
          <p>The generated prompt contains:</p>
          <ul>
            <li>The repository identity, score, and exact ruleset version.</li>
            <li>
              Grouped fixes, product decisions, and manual verification work.
            </li>
            <li>Evidence, suggested fixes, and acceptance criteria.</li>
            <li>Detected project gates and the exact rescan command.</li>
          </ul>
          <p>
            Add a path or category before the flag to narrow the handoff, for
            example <code>../my-app --category accessibility --prompt</code>.
          </p>
        </section>

        <section id="apply">
          <h2>Apply with an installed agent</h2>
          <div className="not-typeset mt-4">
            <CodeBlockCommand {...getCliCommands("--apply --agent codex")} />
          </div>
          <p>
            <code>--apply</code> prints the report, creates the same neutral
            remediation prompt, and opens Claude Code, Codex CLI, or Grok Build
            in the package-manager root. Omit <code>--agent</code> to choose
            from the matching candidates Shadscan finds on <code>PATH</code>.
            The selected provider is validated before launch.
          </p>
          <p>
            Agent launch is disabled in CI and when the input, output, or error
            stream is not an interactive terminal. Shadscan rejects
            project-local executables, checks the provider identity, launches
            with an argument array and no user-controlled shell command or
            approval-bypass flags, and removes its private prompt file when the
            agent exits.
          </p>
          <p>
            The external agent may read and edit files, run commands, and send
            prompt data to its provider. A failed agent exits non-zero and can
            never clear a failed <code>--fail-under</code> gate.
          </p>
        </section>

        <section id="automation">
          <h2>Use JSON and score gates</h2>
          <h3>Read the complete report</h3>
          <div className="not-typeset mt-4">
            <CodeBlockCommand {...getCliCommands("--json")} />
          </div>
          <p>
            JSON output includes the score, category summaries, every rule
            result, and <code>agentHandoff</code>. The current audit schema
            version is <code>4</code>.
          </p>
          <h3>Fail CI below a score</h3>
          <div className="not-typeset mt-4">
            <CodeBlockCommand {...getCliCommands("--json --fail-under 80")} />
          </div>
          <p>
            Findings normally exit with status <code>0</code>. With{" "}
            <code>--fail-under</code>, Shadscan exits with status <code>1</code>
            when the score is below the floor or cannot be assessed. Discovery
            and audit failures also exit with status <code>1</code>.
          </p>
          <h3>Run one category</h3>
          <div className="not-typeset mt-4">
            <CodeBlockCommand {...getCliCommands("--category accessibility")} />
          </div>
        </section>

        <section id="github-action">
          <h2>Audit every push with the GitHub Action</h2>
          <p>
            The shadscan repository doubles as a composite GitHub Action. It
            runs the CLI against your project, writes the score and category
            table to the job summary, optionally fails the job below a score
            floor, and can keep a single tracked issue up to date with the
            findings and a paste-ready agent handoff.
          </p>
          <DocsCodeBlock
            code={GITHUB_ACTION_WORKFLOW}
            label=".github/workflows/shadscan.yml"
            language="text"
          />
          <p>
            Inputs: <code>path</code>, <code>version</code>,{" "}
            <code>category</code>, <code>fail-under</code>,{" "}
            <code>create-issue</code>, <code>issue-label</code>, and{" "}
            <code>github-token</code>. Outputs: <code>score</code>,{" "}
            <code>grade</code>, and <code>report-path</code> for downstream
            steps. Pin an exact CLI <code>version</code> in CI — a moving
            dist-tag is not a reproducible build input.
          </p>
          <p>
            With <code>create-issue</code> enabled, the action needs the{" "}
            <code>issues: write</code> permission. Instead of filing a new issue
            on every run, it updates one open issue per label, and the issue
            body embeds the same <code>--prompt</code> handoff you would
            generate locally — assign the issue to your coding agent and the
            remediation plan is already inside it.
          </p>
        </section>

        <section id="pre-commit">
          <h2>Add a pre-commit score gate</h2>
          <p>
            A local interactive scan ends with a post-scan menu: copy the agent
            handoff to your clipboard (it prints too), print it without copying,
            launch an installed agent, or add a score gate when no active
            blocking Shadscan hook protects the project yet. Pick with the arrow
            keys and Enter — the handoff is highlighted first, so a single Enter
            grabs it. Press <code>Esc</code> to keep just the score, or use{" "}
            <code>--no-interactive</code> to suppress the menu entirely.
            Category-scoped scans do not offer a hook because their score cannot
            establish a full-project floor.
          </p>
          <h3>Preview the exact hook plan</h3>
          <div className="not-typeset mt-4">
            <CodeBlockCommand
              {...getCliCommands("setup --pre-commit --dry-run")}
            />
          </div>
          <h3>Apply a reviewed plan without another prompt</h3>
          <div className="not-typeset mt-4">
            <CodeBlockCommand {...getCliCommands("setup --pre-commit --yes")} />
          </div>
          <p>
            The plan pins the exact Shadscan version and uses the current
            complete assessed score as its <code>--fail-under</code> floor.
            Shadscan can safely create or extend simple native Git hooks using
            POSIX <code>sh</code> or <code>dash</code>. It preserves existing
            commands, never executes the hook, and gives manual instructions for
            Husky, Lefthook, simple-git-hooks, pre-commit, conflicting managers,
            other shell interpreters, and opaque native hooks.
          </p>
        </section>

        <section id="agent-skill">
          <h2>Run it before agent commits</h2>
          <p>
            The optional <code>shadscan-pre-commit</code> skill establishes a
            baseline and requires AI agents to rerun the audit immediately
            before every commit. It adds no Git hook or project dependency; use{" "}
            <code>shadscan setup --pre-commit</code> when you want an actual
            repository hook.
          </p>
          <div className="not-typeset mt-4">
            <CodeBlockCommand
              bun="bunx --bun skills add TheOrcDev/skills --skill shadscan-pre-commit --global"
              npm="npx skills add TheOrcDev/skills --skill shadscan-pre-commit --global"
              pnpm="pnpm dlx skills add TheOrcDev/skills --skill shadscan-pre-commit --global"
              yarn="yarn dlx skills add TheOrcDev/skills --skill shadscan-pre-commit --global"
            />
          </div>
          <DocsCodeBlock
            code={AGENT_PROMPT}
            label="Agent prompt"
            language="text"
          />
        </section>

        <section id="mcp-server">
          <h2>MCP server</h2>
          <p>
            <code>shadscan mcp</code> serves the audit over the Model Context
            Protocol on stdio, so coding agents query results as typed tool
            calls instead of parsing output. Three read-only tools:{" "}
            <code>scan</code> returns the score and actionables, filterable by
            category, severity, or workspace package; <code>list_projects</code>{" "}
            classifies a monorepo&apos;s packages; <code>explain_rule</code>{" "}
            describes one rule. Every call re-scans the current file state —
            results are never cached — and the server only reads inside the
            roots it was started with.
          </p>
          <DocsCodeBlock
            code="claude mcp add shadscan -- npx -y @shadscan/cli mcp"
            label="Claude Code"
            language="bash"
          />
          <p>
            Setup for other clients, the tool reference, and the security
            posture live in the{" "}
            <a
              href="https://github.com/TheOrcDev/shadscan/blob/main/docs/mcp.md"
              rel="noopener noreferrer"
              target="_blank"
            >
              MCP runbook
            </a>
            .
          </p>
        </section>

        <section id="project-rule">
          <h2>Make it a project rule</h2>
          <p>
            Add this policy to <code>AGENTS.md</code>, or the equivalent
            instruction file for your agent, to activate the skill for future
            commit tasks.
          </p>
          <DocsCodeBlock
            code={PROJECT_RULE}
            label="AGENTS.md"
            language="markdown"
          />
        </section>

        <section id="troubleshooting">
          <h2>Troubleshooting</h2>
          <h3>An older version runs right after a release</h3>
          <p>
            pnpm 11.15 and newer delays newly published versions through its{" "}
            <code>minimumReleaseAge</code> supply-chain setting, so{" "}
            <code>pnpm dlx @shadscan/cli</code> can silently resolve to the
            previous release for a few days after a new one ships. Pin the exact
            version (<code>@shadscan/cli@&lt;version&gt;</code>) to run it
            immediately, or wait for the delay to pass.
          </p>
          <h3>A stale version keeps running</h3>
          <p>
            One-shot runners cache downloads. If an old version persists after
            an update, pin the exact version, or clear the cache:{" "}
            <code>npx --yes</code> forces a fresh resolution and{" "}
            <code>pnpm store prune</code> drops unreferenced packages. Check
            what actually ran with <code>--version</code>.
          </p>
        </section>
      </article>
    </main>
  );
}
