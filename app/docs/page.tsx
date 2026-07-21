import { CodeBlockCommand } from "@/components/code-block-command";
import { CopyButton } from "@/components/copy-button";
import { DocsOnThisPage } from "@/components/docs-on-this-page";
import { createPageMetadata } from "@/lib/site-metadata";

const CLI_PACKAGE = "@shadscan/cli@next";

const AGENT_PROMPT =
  "Use $shadscan-pre-commit for this task. Establish the current score before editing, run Shadscan immediately before every commit, and do not commit if the audit is unassessed or below the task floor.";

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
    description: "Print command usage and all available options.",
    option: "--help",
  },
  {
    description: "Print the installed Shadscan version.",
    option: "--version",
  },
] as const;

const sections = [
  { href: "#usage", label: "Usage" },
  { href: "#options", label: "Options" },
  { href: "#agent-prompt", label: "Agent prompt" },
  { href: "#automation", label: "JSON and CI" },
  { href: "#agent-skill", label: "Agent skill" },
  { href: "#project-rule", label: "Project rule" },
] as const satisfies ReadonlyArray<{ href: `#${string}`; label: string }>;

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
    "Run Shadscan, choose human, JSON, or agent-prompt output, enforce score thresholds, and add the optional agent commit workflow.",
  imageAlt: "Shadscan CLI usage, options, and agent prompt output",
  imagePath: "/docs/opengraph-image",
  path: "/docs",
  title: "Shadscan CLI documentation",
});

export default function DocsPage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-16">
      <aside className="hidden lg:block">
        <DocsOnThisPage sections={sections} />
      </aside>

      <article className="typeset min-w-0 max-w-3xl pb-20 [&_section[id]]:scroll-mt-10">
        <header>
          <p className="not-typeset font-mono text-muted-foreground text-sm">
            CLI documentation
          </p>
          <h1>Shadscan CLI</h1>
          <div className="not-typeset mt-5">
            <CodeBlockCommand {...getCliCommands()} />
          </div>
          <p>
            Run this from the root of a React shadcn app. The one-shot command
            needs no project install. Shadscan reads source and configuration,
            prints the audit, and leaves the project unchanged.
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
          <h3>Scan another directory</h3>
          <div className="not-typeset mt-4">
            <CodeBlockCommand {...getCliCommands("../my-shadcn-app")} />
          </div>
          <p>
            The default human report includes the overall score, category
            scores, evidence, fixes, and agent-ready actionables. Roast copy is
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
            with <code>--format</code>.
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
            agent. Shadscan does not call an AI model itself.
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

        <section id="automation">
          <h2>Use JSON and score gates</h2>
          <h3>Read the complete report</h3>
          <div className="not-typeset mt-4">
            <CodeBlockCommand {...getCliCommands("--json")} />
          </div>
          <p>
            JSON output includes the score, category summaries, every rule
            result, and <code>agentHandoff</code>. The current audit schema
            version is <code>3</code>.
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

        <section id="agent-skill">
          <h2>Run it before agent commits</h2>
          <p>
            The optional <code>shadscan-pre-commit</code> skill establishes a
            baseline and requires AI agents to rerun the audit immediately
            before every commit. It adds no Git hook or project dependency.
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
      </article>
    </main>
  );
}
