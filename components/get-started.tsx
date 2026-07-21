"use client";

import { SparkleIcon } from "@phosphor-icons/react";

import { CodeBlockCommand } from "@/components/code-block-command";
import { CopyButton } from "@/components/copy-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const AGENT_PROMPT = `Audit this project's UI with shadscan — a deterministic auditor for React shadcn apps that flags accessibility, state, form, and composition issues.

Run it from the repo root:
npx @shadscan/cli@next

Then, without editing any code yet:
1. Summarize the findings grouped by severity, and point out the files with the most issues.
2. Propose a prioritized remediation plan — group related findings into concrete fixes, order them by severity and impact, and note the approach and any risk for each.
3. Stop and share the plan so I can review it, and wait for my approval before changing anything.`;

export function GetStarted() {
  return (
    <Tabs className="w-full gap-4" defaultValue="manual">
      <TabsList className="mx-auto">
        <TabsTrigger value="manual">Manual</TabsTrigger>
        <TabsTrigger value="agent">AI agent</TabsTrigger>
      </TabsList>

      <TabsContent value="manual">
        <CodeBlockCommand
          bun="bunx @shadscan/cli@next"
          npm="npx @shadscan/cli@next"
          pnpm="pnpm dlx @shadscan/cli@next"
          yarn="yarn dlx --package @shadscan/cli@next shadscan"
        />
      </TabsContent>

      <TabsContent value="agent">
        <div className="relative overflow-hidden rounded-none bg-code text-left">
          <div className="flex h-10 items-center gap-2 pr-10 pl-4 shadow-[inset_0_-1px_0_0] shadow-border">
            <SparkleIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-mono text-muted-foreground text-xs uppercase tracking-wider">
              Agent prompt
            </span>
          </div>

          <p className="whitespace-pre-wrap p-4 text-muted-foreground text-sm leading-6">
            {AGENT_PROMPT}
          </p>

          <CopyButton
            className="absolute top-2 right-2 z-10 size-6 rounded-none border-none [&_svg:not([class*='size-'])]:size-3.5"
            size="icon-sm"
            text={AGENT_PROMPT}
            variant="ghost"
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}
