"use client";

import { CodeBlockCommand } from "@/components/code-block-command";
import { AGENT_AUDIT_PROMPT } from "@/lib/agent-prompt";

export function GetStarted() {
  return (
    <CodeBlockCommand
      bun="bunx @shadscan/cli"
      npm="npx @shadscan/cli"
      pnpm="pnpm dlx @shadscan/cli"
      prompt={AGENT_AUDIT_PROMPT}
      yarn="yarn dlx --package @shadscan/cli shadscan"
    />
  );
}
