const AGENT_AUDIT_PROMPT = `Audit this project's UI with shadscan — a deterministic auditor for React shadcn apps that flags accessibility, state, form, and composition issues.

From the repo root, generate the agent handoff:
npx @shadscan/cli@next --prompt

The handoff groups findings into fix, decide, and verify work items with evidence and acceptance criteria. Then, without editing any code yet:
1. Summarize the work items by severity, and point out the files with the most issues.
2. Propose a prioritized remediation plan from the fix items, and list every decide item as a question for me rather than a task.
3. Stop and share the plan so I can review it, and wait for my approval before changing anything.`;

export { AGENT_AUDIT_PROMPT };
