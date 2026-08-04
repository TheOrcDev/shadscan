import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import packageJson from "../../package.json";
import {
  ExplainRuleInputSchema,
  ListProjectsInputSchema,
  ScanInputSchema,
} from "./contracts";
import {
  explainRuleTool,
  listProjectsTool,
  type McpToolsOptions,
  scanTool,
  toToolErrorMessage,
} from "./tools";

/**
 * Every tool call runs a fresh scan; the server holds no result state.
 * shadscan is deterministic over file state, so the moment an agent edits a
 * file any cached answer is wrong — precisely when the agent most needs the
 * truth. Scans cost roughly one second on a typical project, which is cheap
 * enough to buy correctness on every call.
 */

const asToolResult = (payload: unknown) => ({
  content: [{ text: JSON.stringify(payload, null, 2), type: "text" as const }],
});

const asToolError = (error: unknown) => ({
  content: [{ text: toToolErrorMessage(error), type: "text" as const }],
  isError: true as const,
});

const createShadscanMcpServer = (options: McpToolsOptions): McpServer => {
  const server = new McpServer({
    name: "shadscan",
    version: packageJson.version,
  });

  server.registerTool(
    "scan",
    {
      description:
        "Audit a React shadcn project and return its score plus actionable findings. Re-scans the current file state on every call — results are never cached, so call it again after editing to see the delta. Filter with category, severity, or packageDir (monorepos); set full=true for the complete findings list.",
      inputSchema: ScanInputSchema.shape,
    },
    async (input, extra) => {
      try {
        return asToolResult(
          await scanTool(options, ScanInputSchema.parse(input), extra.signal)
        );
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    "list_projects",
    {
      description:
        "List the packages shadscan can audit under a workspace root, with each one classified as an application or a library and the reason for the classification. Use before scan on a monorepo to learn the packageDir values.",
      inputSchema: ListProjectsInputSchema.shape,
    },
    async (input) => {
      try {
        return asToolResult(
          await listProjectsTool(options, ListProjectsInputSchema.parse(input))
        );
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.registerTool(
    "explain_rule",
    {
      description:
        "Explain one shadscan rule: what it checks, its category, which framework adapters it applies to, and its confidence level. Rule ids come from scan results as findingId.",
      inputSchema: ExplainRuleInputSchema.shape,
    },
    (input) => {
      try {
        return asToolResult(
          explainRuleTool(ExplainRuleInputSchema.parse(input))
        );
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  return server;
};

/**
 * stdout belongs to JSON-RPC from here on; the single startup line and any
 * abnormal-exit diagnostics go to stderr, then silence.
 */
const runMcpServer = async (rootArguments: string[]): Promise<void> => {
  const roots = (rootArguments.length > 0 ? rootArguments : ["."]).map((root) =>
    path.resolve(root)
  );
  const server = createShadscanMcpServer({ roots });
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  process.stderr.write(
    `shadscan mcp ${packageJson.version} serving ${roots.join(", ")} over stdio\n`
  );
};

export { createShadscanMcpServer, runMcpServer };
