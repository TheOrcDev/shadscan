import {
  ArrowRight,
  BracketsCurly,
  CheckCircle,
  Gauge,
  Lightning,
  TerminalWindow,
  WarningCircle,
} from "@phosphor-icons/react/ssr";
import { CommandMenu } from "@/components/command-menu";
import { Button } from "@/components/ui/button";

const reportRows = [
  {
    label: "Theme provider",
    status: "pass",
    text: "next-themes mounted in app layout",
  },
  {
    label: "Dark mode shortcut",
    status: "pass",
    text: "d key toggles theme outside typing targets",
  },
  {
    label: "Command menu",
    status: "fail",
    text: "No Cmd+K command surface found",
  },
  {
    label: "Empty states",
    status: "fail",
    text: "Lists need explicit zero-result UI",
  },
  {
    label: "Icon labels",
    status: "pass",
    text: "No unlabeled icon-only buttons found",
  },
] as const;

const categories = [
  ["Foundation", "20/20"],
  ["Interaction", "11/20"],
  ["States", "6/20"],
  ["Accessibility", "20/20"],
  ["Forms", "4/10"],
  ["Production Polish", "3/10"],
] as const;

const checks = [
  "Next App Router, Vite React, and generic React fallback",
  "Static source audit only",
  "Evidence, confidence, remediation, and JSON output",
  "Neutral CI logs, roast copy for local runs",
] as const;

export default function Page() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <section className="border-b bg-[linear-gradient(180deg,color-mix(in_oklch,var(--primary),transparent_88%),transparent_42%)]">
        <div className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 px-5 py-6 sm:px-8 lg:px-10">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 font-medium text-sm">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <TerminalWindow weight="bold" />
              </span>
              Shadscan
            </div>
            <CommandMenu />
          </header>

          <div className="grid min-w-0 flex-1 content-center gap-8">
            <div className="min-w-0 max-w-4xl">
              <p className="mb-3 flex items-center gap-2 text-muted-foreground text-sm">
                <Gauge className="size-4 text-primary" weight="bold" />
                UI audit CLI for shadcn apps
              </p>
              <h1 className="max-w-4xl text-balance font-heading font-medium text-5xl tracking-normal sm:text-6xl lg:text-7xl">
                Shadscan has entered the chat.
              </h1>
              <p className="mt-5 max-w-2xl text-lg text-muted-foreground leading-8">
                Run it in a React shadcn app and get a score for the product
                basics people forget: command menus, theme shortcuts, states,
                labels, metadata, and app boundaries.
              </p>
            </div>

            <div className="grid min-w-0 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <section
                aria-label="Sample Shadscan audit report"
                className="min-w-0 overflow-hidden border bg-card shadow-sm"
              >
                <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-3">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="size-2 rounded-full bg-destructive" />
                    <span className="size-2 rounded-full bg-[oklch(0.78_0.16_85)]" />
                    <span className="size-2 rounded-full bg-[oklch(0.72_0.18_150)]" />
                  </div>
                  <div className="font-mono text-muted-foreground text-xs">
                    node packages/cli/dist/cli.js .
                  </div>
                </div>

                <div className="space-y-5 p-4 font-mono text-sm sm:p-5">
                  <div>
                    <p className="text-muted-foreground">Your Shadscan score</p>
                    <div className="mt-2 flex flex-wrap items-end gap-3">
                      <span className="font-heading text-6xl text-primary">
                        64
                      </span>
                      <span className="pb-2 text-muted-foreground">/100</span>
                      <span className="mb-2 border border-destructive/30 bg-destructive/10 px-2 py-1 text-destructive text-xs">
                        Grade D
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    {categories.map(([label, value]) => (
                      <div
                        className="flex items-center justify-between border bg-background px-3 py-2"
                        key={label}
                      >
                        <span className="text-muted-foreground">{label}</span>
                        <span>{value}</span>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    {reportRows.map((row) => (
                      <div
                        className="grid gap-2 border bg-background px-3 py-3 sm:grid-cols-[150px_1fr]"
                        key={row.label}
                      >
                        <div className="flex items-center gap-2">
                          {row.status === "pass" ? (
                            <CheckCircle
                              className="size-4 text-[oklch(0.62_0.18_150)]"
                              weight="bold"
                            />
                          ) : (
                            <WarningCircle
                              className="size-4 text-destructive"
                              weight="bold"
                            />
                          )}
                          <span>{row.label}</span>
                        </div>
                        <p className="text-muted-foreground">{row.text}</p>
                      </div>
                    ))}
                  </div>

                  <div className="border border-destructive/30 bg-destructive/10 px-3 py-3 text-destructive">
                    Missing: Command menu with Cmd+K. Navigating by hope is not
                    an information architecture.
                  </div>
                </div>
              </section>

              <aside className="grid min-w-0 grid-cols-1 gap-4">
                <div className="border bg-card p-5">
                  <div className="mb-4 flex items-center gap-2 font-medium">
                    <Lightning className="size-4 text-primary" weight="bold" />
                    Ships as a read-only audit
                  </div>
                  <ul className="space-y-3 text-muted-foreground text-sm leading-6">
                    {checks.map((check) => (
                      <li className="flex gap-2" key={check}>
                        <CheckCircle
                          className="mt-1 size-4 shrink-0 text-[oklch(0.62_0.18_150)]"
                          weight="bold"
                        />
                        <span>{check}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border bg-card p-5">
                  <div className="mb-4 flex items-center gap-2 font-medium">
                    <BracketsCurly
                      className="size-4 text-primary"
                      weight="bold"
                    />
                    Run from source
                  </div>
                  <pre className="overflow-x-auto bg-foreground p-4 text-background text-sm">
                    <code>node packages/cli/dist/cli.js /path/to/app</code>
                  </pre>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button asChild>
                      <a href="#report">
                        See checks
                        <ArrowRight data-icon="inline-end" weight="bold" />
                      </a>
                    </Button>
                    <Button asChild variant="outline">
                      <a href="https://github.com/TheOrcDev/headless-shadcn">
                        GitHub
                      </a>
                    </Button>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b" id="report">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-12 sm:px-8 lg:grid-cols-3 lg:px-10">
          {[
            [
              "Evidence first",
              "Every finding carries the file or pattern that triggered it.",
            ],
            [
              "Adapter aware",
              "Next, Vite, and generic React apps get equivalent checks.",
            ],
            [
              "CI safe",
              "JSON output is neutral by default and stable enough to gate on.",
            ],
          ].map(([title, body]) => (
            <article className="border bg-card p-5" key={title}>
              <h2 className="font-medium">{title}</h2>
              <p className="mt-2 text-muted-foreground text-sm leading-6">
                {body}
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
