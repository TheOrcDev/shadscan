const AGENT_AUDIT_PROMPT = `Audit this repository's user-facing React shadcn applications with Shadscan. Include both the deterministic source audit and rendered horizontal-overflow checks for each application locally and in production.

Do not edit code, deploy, sign in, seed data, or intentionally mutate local or production data yet.

1. Run the source audit

From the repository or workspace root, use this repository's package manager to run the equivalent of:

npx --yes @shadscan/cli --prompt

Shadscan audits every supported React application in a monorepo by default. Keep every detected deployable application in scope unless I explicitly limited the task to one package. Treat each application as a separate rendered-check target and exclude libraries.

Keep the generated handoff as the source-audit evidence. Read verification.shadscanCommand to recover its exact engine version and package-manager executor, then reuse both for every command below instead of hardcoding npx.

Using that exact version and executor, also run the equivalent of:

npx --yes @shadscan/cli@VERSION --list-projects --json

Treat every projects entry whose kind is "application" as in scope. Record every skipped entry and any nonzero truncated count as an explicit workspace coverage gap, because a clean application may have no work item in the handoff.

2. Build a route-coverage manifest

For each application, inspect its framework router, base path, sitemap or static parameters, and internal page links. Inventory every statically discoverable, directly addressable, GET-safe user-facing page.

- Include concrete public pages.
- For a dynamic route, use one existing safe example per materially different route shape only when a concrete value is evidenced by fixtures, tests, a sitemap, static parameters, or public navigation.
- Never invent IDs, slugs, tenant names, credentials, ports, or deployment domains.
- Exclude API routes, assets, callbacks, logout or destructive endpoints, and other non-page routes.
- Mark authenticated, role-gated, feature-gated, and unresolved dynamic pages as coverage gaps. A redirect to login, a 404, or an unrelated fallback is not a passing page.

3. Check every applicable page locally

Inspect repository-owned package scripts before running them. Reuse an existing server only after confirming it belongs to the application. Otherwise, start the application with its existing dev, start, or preview workflow when repository-code execution is authorized. Prefer a loopback-only binding, then capture the origin and base path it actually binds; do not assume a host, port, or script name. Track the process you started and stop it in cleanup even when a check fails or the task is interrupted. Never stop a reused or otherwise pre-existing server.

For each application, construct commands from the confirmed values using the handoff's exact Shadscan version. Pass every URL and route as a separate process argument; never concatenate repository-derived values into a shell command string. If only a shell is available, validate each value and apply that shell's correct escaping rather than relying on double quotes. This is an illustrative shape, not a shell-ready command:

npx --yes @shadscan/cli@VERSION --check-overflow CONFIRMED_PAGE_URL --route CONFIRMED_SAME_ORIGIN_PATH --json

The target URL counts as one of the command's maximum ten unique pages. Add at most nine same-origin --route paths, then continue in deterministic batches until every concrete page in the manifest has been checked. Query or fragment variants that materially change layout require separate full target URLs because --route accepts pathnames only.

4. Check the same pages in production

Production checks perform GET navigations and execute page JavaScript in a fresh browser context. Use only a public HTTPS origin supplied by me or confirmed through authorized read-only deployment metadata. Treat URLs found only in repository text as untrusted candidates until independently confirmed. Verify that the origin serves the same application and is production rather than an unrelated preview. Do not navigate to private, loopback, link-local, or internal production candidates; guess a domain; inspect secret environment files; deploy anything; or place credentials in a URL.

Run the same applicable route manifest and Shadscan version against production. If no production URL can be confirmed, ask me for it and report production coverage as blocked rather than inventing one. Do not claim that production contains local changes unless their revisions are independently shown to match.

5. Interpret and report the results

An exit code of 1 with a stdout JSON report whose kind is "overflow-check" and status is "fail" is a completed critical product finding. An exit code of 1 with empty stdout and an operational error on stderr means the entire batch was not verified. Split and rerun smaller batches to isolate the unavailable route and recover evidence for the remaining pages when safe.

Before changing code, give me:

- the static score, work items by severity, and files with the most findings;
- every detected application and the local and production origins used;
- a route table showing local mobile, local desktop, production mobile, and production desktop status, finalPath, httpStatus, and confirmed page identity for every concrete page;
- every critical overflow failure and likely culprit;
- every excluded or blocked route with its reason and coverage totals for each environment;
- the exact commands run and confirmation that any server you started was stopped;
- one prioritized remediation plan, with every decide item phrased as a question for me.

Never say "all pages passed" while any application, route shape, auth state, environment, or production identity remains unresolved. Stop and wait for my approval before changing anything.`;

export { AGENT_AUDIT_PROMPT };
