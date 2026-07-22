"use client";

import { CodeBlockCommand } from "@/components/code-block-command";
import { AGENT_AUDIT_PROMPT } from "@/lib/agent-prompt";

export function GetStarted() {
  return (
    <CodeBlockCommand
      bun="bunx @shadscan/cli@next"
      npm="npx @shadscan/cli@next"
      pnpm="pnpm dlx @shadscan/cli@next"
      prompt={AGENT_AUDIT_PROMPT}
      yarn="yarn dlx --package @shadscan/cli@next shadscan"
    />
  );
}
