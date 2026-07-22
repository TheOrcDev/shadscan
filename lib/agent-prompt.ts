const AGENT_AUDIT_PROMPT = `Audit this project's UI with shadscan — a deterministic auditor for React shadcn apps that flags accessibility, state, form, and composition issues.

Run it from the repo root:
npx @shadscan/cli@next

Then, without editing any code yet:
1. Summarize the findings grouped by severity, and point out the files with the most issues.
2. Propose a prioritized remediation plan — group related findings into concrete fixes, order them by severity and impact, and note the approach and any risk for each.
3. Stop and share the plan so I can review it, and wait for my approval before changing anything.`;

export { AGENT_AUDIT_PROMPT };
