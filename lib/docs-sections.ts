import type { DocsSection } from "@/components/docs-on-this-page";

const DOCS_SECTIONS = [
  { href: "#usage", label: "Usage" },
  { href: "#overflow-check", label: "Overflow check" },
  { href: "#options", label: "Options" },
  { href: "#agent-prompt", label: "Agent prompt" },
  { href: "#apply", label: "Apply with an agent" },
  { href: "#automation", label: "JSON and CI" },
  { href: "#github-action", label: "GitHub Action" },
  { href: "#pre-commit", label: "Pre-commit gate" },
  { href: "#agent-skill", label: "Agent skill" },
  { href: "#mcp-server", label: "MCP server" },
  { href: "#project-rule", label: "Project rule" },
  { href: "#troubleshooting", label: "Troubleshooting" },
] as const satisfies readonly DocsSection[];

export { DOCS_SECTIONS };
