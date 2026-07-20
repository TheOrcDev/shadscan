import type { Metadata } from "next";
import { CodeBlockCommand } from "@/components/code-block-command";
import { CopyButton } from "@/components/copy-button";

const PACKAGE_SCRIPT = `{
  "scripts": {
    "audit:ui": "shadscan --fail-under 80 --no-roast"
  }
}`;

const HUSKY_HOOK = "pnpm run audit:ui";

const SKILL_PROMPT =
  "Use $shadscan-pre-commit to add a safe Shadscan pre-commit gate to this repository.";

const sections = [
  { href: "#quick-start", label: "Quick start" },
  { href: "#score-floor", label: "Set the score floor" },
  { href: "#existing-hooks", label: "Existing hooks" },
  { href: "#agent-skill", label: "Agent skill" },
  { href: "#verify", label: "Verify the gate" },
] as const;

interface DocsCodeBlockProps {
  code: string;
  label: string;
  language: "bash" | "json" | "text";
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
      <pre className="overflow-x-auto overscroll-x-contain p-4 text-sm leading-6">
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

export const metadata: Metadata = {
  alternates: { canonical: "/docs" },
  description:
    "Run a deterministic Shadscan audit before every commit and prevent shadcn UI regressions.",
  openGraph: {
    description:
      "Run a deterministic Shadscan audit before every commit and prevent shadcn UI regressions.",
    title: "Shadscan pre-commit guide",
    url: "/docs",
  },
  title: "Pre-commit guide",
};

export default function DocsPage() {
  return (
    <main className="mx-auto grid min-h-[calc(100svh-3.5rem)] w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-16">
      <aside className="hidden lg:block">
        <nav aria-label="On this page" className="sticky top-8">
          <p className="mb-3 font-medium text-foreground text-sm">
            On this page
          </p>
          <ul className="space-y-1 border-l">
            {sections.map((section) => (
              <li key={section.href}>
                <a
                  className="block border-transparent border-l px-3 py-1.5 text-muted-foreground text-sm hover:border-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                  href={section.href}
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <article className="typeset min-w-0 max-w-3xl pb-20">
        <header>
          <p className="not-typeset font-mono text-muted-foreground text-sm">
            Commit automation
          </p>
          <h1>Run Shadscan before every commit</h1>
          <p>
            Put the audit in a tracked Git hook so every commit checks the
            project against the same score floor. A failed audit exits nonzero,
            and Git leaves the commit untouched.
          </p>
        </header>

        <section id="quick-start">
          <h2>Quick start</h2>
          <p>
            These steps are for a repository without a Git hook manager. When
            one is already configured, keep it and continue at the existing
            hooks section.
          </p>
          <ol>
            <li>
              <strong>Install local, locked dependencies.</strong> Keeping
              Shadscan in the project avoids a registry request on every commit
              and makes the lockfile the source of truth.
              <div className="not-typeset mt-4">
                <CodeBlockCommand
                  bun="bun add --dev shadscan husky"
                  npm="npm install --save-dev shadscan husky"
                  pnpm="pnpm add --save-dev shadscan husky"
                  yarn="yarn add --dev shadscan husky"
                />
              </div>
            </li>
            <li>
              <strong>Add an audit script.</strong> Start with 80, or use the
              current project score as described below.
              <DocsCodeBlock
                code={PACKAGE_SCRIPT}
                label="package.json"
                language="json"
              />
            </li>
            <li>
              <strong>Initialize Husky.</strong> This creates a tracked
              <code>.husky/pre-commit</code> file and configures package
              installation to activate the hooks.
              <div className="not-typeset mt-4">
                <CodeBlockCommand
                  bun="bunx husky init"
                  npm="npx husky init"
                  pnpm="pnpm exec husky init"
                  yarn="yarn run postinstall"
                />
              </div>
              <p>
                Yarn uses Husky&apos;s manual setup: add
                <code>&quot;postinstall&quot;: &quot;husky&quot;</code> to the
                package scripts before running the Yarn tab command. The agent
                skill below detects and configures this case for you.
              </p>
            </li>
            <li>
              <strong>Run the audit from the hook.</strong> Replace the sample
              command created by Husky, or append this line when the hook
              already does other work.
              <DocsCodeBlock
                code={HUSKY_HOOK}
                label=".husky/pre-commit"
                language="bash"
              />
            </li>
          </ol>
        </section>

        <section id="score-floor">
          <h2>Set the score floor</h2>
          <p>
            For a new app, <code>--fail-under 80</code> is a useful team target.
            For an existing app, run a baseline first and set the threshold to
            its current score. That blocks regressions today without requiring
            an all-at-once cleanup.
          </p>
          <div className="not-typeset mt-4">
            <CodeBlockCommand
              bun="bunx shadscan --json"
              npm="npx shadscan --json"
              pnpm="pnpm exec shadscan --json"
              yarn="yarn shadscan --json"
            />
          </div>
          <p>
            Read the top-level <code>score</code> from the JSON output and place
            that integer after <code>--fail-under</code>. Raise it as the UI
            improves; do not lower it to make a failing commit pass.
          </p>
        </section>

        <section id="existing-hooks">
          <h2>Keep existing hooks intact</h2>
          <p>
            Add Shadscan after the commands already in the pre-commit hook.
            Reuse Husky, Lefthook, or simple-git-hooks when the repository has
            one configured. Two hook managers competing for
            <code>core.hooksPath</code> will make the result unpredictable.
          </p>
          <p>
            Shadscan audits the working tree as it exists at commit time, not
            only the staged diff. It reports findings and exits; it does not
            rewrite or restage source files.
          </p>
        </section>

        <section id="agent-skill">
          <h2>Let an agent configure it</h2>
          <p>
            Install the canonical skill through the Skills CLI. It detects the
            package manager, takes a baseline, preserves existing hooks, adds a
            local Shadscan dependency, and verifies both passing and failing
            exit codes.
          </p>
          <div className="not-typeset mt-4">
            <CodeBlockCommand
              bun="bunx --bun skills add TheOrcDev/skills --skill shadscan-pre-commit"
              npm="npx skills add TheOrcDev/skills --skill shadscan-pre-commit"
              pnpm="pnpm dlx skills add TheOrcDev/skills --skill shadscan-pre-commit"
              yarn="yarn dlx skills add TheOrcDev/skills --skill shadscan-pre-commit"
            />
          </div>
          <p>Then give your agent this prompt:</p>
          <DocsCodeBlock
            code={SKILL_PROMPT}
            label="Agent prompt"
            language="text"
          />
        </section>

        <section id="verify">
          <h2>Verify the gate</h2>
          <p>Run the package script directly before relying on the hook.</p>
          <div className="not-typeset mt-4">
            <CodeBlockCommand
              bun="bun run audit:ui"
              npm="npm run audit:ui"
              pnpm="pnpm run audit:ui"
              yarn="yarn run audit:ui"
            />
          </div>
          <p>
            A score at or above the floor exits with code 0. A lower or
            unassessed score exits nonzero and blocks the commit. Use
            <code>git commit --no-verify</code> only as an emergency bypass, and
            pair the same audit with CI when the team needs enforcement that
            cannot be skipped locally.
          </p>
        </section>
      </article>
    </main>
  );
}
