import { CodeBlockCommand } from "@/components/code-block-command";
import { CopyButton } from "@/components/copy-button";
import { DocsOnThisPage } from "@/components/docs-on-this-page";
import { createPageMetadata } from "@/lib/site-metadata";

const AGENT_PROMPT =
  "Use $shadscan-pre-commit for this task. Establish the current score before editing, run Shadscan immediately before every commit, and do not commit if the audit is unassessed or below the task floor.";

const PROJECT_RULE = `## Shadscan

Before creating any commit, use $shadscan-pre-commit. Establish the current score when work begins, run Shadscan immediately before each commit, and do not commit if the score is unassessed or below the task floor.`;

const sections = [
  { href: "#install", label: "Install the skill" },
  { href: "#activate", label: "Activate it" },
  { href: "#protocol", label: "Agent protocol" },
  { href: "#project-rule", label: "Project rule" },
  { href: "#agent-only", label: "Agent-only scope" },
] as const satisfies ReadonlyArray<{ href: `#${string}`; label: string }>;

interface DocsCodeBlockProps {
  code: string;
  label: string;
  language: "bash" | "markdown" | "text";
}

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
    "Install the Shadscan agent skill and require a deterministic UI audit before every AI-generated commit.",
  imageAlt: "Make AI agents run shadscan before every commit",
  imagePath: "/docs/opengraph-image",
  path: "/docs",
  title: "Shadscan for AI agents",
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
            Agent workflow
          </p>
          <h1>Make agents run Shadscan before every commit</h1>
          <p>
            The Shadscan skill gives AI agents a commit protocol. It records the
            project&apos;s starting score, audits the working tree immediately
            before each commit, and stops the agent when the score regresses.
            Your project tooling stays untouched.
          </p>
        </header>

        <section id="install">
          <h2>Install the skill</h2>
          <p>
            Install the canonical skill globally so supported agents can use it
            in any repository.
          </p>
          <div className="not-typeset mt-4">
            <CodeBlockCommand
              bun="bunx --bun skills add TheOrcDev/skills --skill shadscan-pre-commit --global"
              npm="npx skills add TheOrcDev/skills --skill shadscan-pre-commit --global"
              pnpm="pnpm dlx skills add TheOrcDev/skills --skill shadscan-pre-commit --global"
              yarn="yarn dlx skills add TheOrcDev/skills --skill shadscan-pre-commit --global"
            />
          </div>
        </section>

        <section id="activate">
          <h2>Activate it for the task</h2>
          <p>
            Give the agent this instruction before it starts changing files. The
            task baseline becomes the default minimum score.
          </p>
          <DocsCodeBlock
            code={AGENT_PROMPT}
            label="Agent prompt"
            language="text"
          />
        </section>

        <section id="protocol">
          <h2>What the agent does</h2>
          <ol>
            <li>
              <strong>Establishes a baseline.</strong> Before editing, the agent
              runs <code>shadscan --json</code> and reads the top-level score.
              It uses a local binary when one already exists, or a one-shot CLI
              command otherwise.
            </li>
            <li>
              <strong>Sets the task floor.</strong> The starting score is the
              minimum by default. A higher score requested by the user becomes
              the new floor. An unassessed result stops the workflow.
            </li>
            <li>
              <strong>Audits before every commit.</strong> After the intended
              edits and tests, the agent scans the complete working tree again.
              A failed audit must be fixed and rerun before committing.
            </li>
            <li>
              <strong>Reports the result.</strong> Each commit is accompanied by
              the baseline, enforced floor, and final score. Findings outside
              the task scope are reported instead of silently bypassed.
            </li>
          </ol>
          <p>
            When Shadscan is not already installed, the agent uses the matching
            one-shot command without adding a dependency:
          </p>
          <div className="not-typeset mt-4">
            <CodeBlockCommand
              bun="bunx @shadscan/cli@next --json"
              npm="npx --yes @shadscan/cli@next --json"
              pnpm="pnpm dlx @shadscan/cli@next --json"
              yarn="yarn dlx --quiet --package @shadscan/cli@next shadscan --json"
            />
          </div>
        </section>

        <section id="project-rule">
          <h2>Make it a project rule</h2>
          <p>
            Add this policy to <code>AGENTS.md</code> so agents that read the
            repository instructions activate the skill for future commit tasks.
            Use the equivalent agent instruction file when your tool uses a
            different filename.
          </p>
          <DocsCodeBlock
            code={PROJECT_RULE}
            label="AGENTS.md"
            language="markdown"
          />
        </section>

        <section id="agent-only">
          <h2>Agent-only by design</h2>
          <p>
            The skill changes agent behavior only. It does not install project
            dependencies, edit package scripts, modify lockfiles, or configure
            Git. It also never rewrites or stages source files while auditing.
          </p>
          <p>
            Commits made manually, or by an agent that has not loaded the skill,
            are not intercepted. That boundary keeps Shadscan entirely inside
            the AI workflow while leaving the developer&apos;s local commit
            process alone.
          </p>
        </section>
      </article>
    </main>
  );
}
