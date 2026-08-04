import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createShadscanMcpServer } from "../src/mcp/server";
import {
  cleanupWorkspaceFixtures,
  createWorkspaceFixture,
} from "./workspace-fixture";

const OUTSIDE_ROOTS_PATTERN = /outside the allowed roots/;
const RULESET_VERSION_PATTERN = /^\d{4}\./;

interface ToolTextResult {
  content: { text: string; type: string }[];
  isError?: boolean;
}

const connect = async (roots: string[]) => {
  const server = createShadscanMcpServer({ roots });
  const client = new Client({ name: "mcp-test", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server };
};

const callTool = async (
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ isError: boolean; payload: unknown; text: string }> => {
  const result = (await client.callTool({
    arguments: args,
    name,
  })) as ToolTextResult;
  const text = result.content[0]?.text ?? "";

  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  return { isError: result.isError === true, payload, text };
};

afterEach(async () => {
  await cleanupWorkspaceFixtures();
});

describe("shadscan mcp server", () => {
  it("lists exactly the three read-only tools", async () => {
    const rootDir = await createWorkspaceFixture({
      kind: "none",
      packages: [{ path: ".", preset: "next" }],
    });
    const { client } = await connect([rootDir]);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "explain_rule",
      "list_projects",
      "scan",
    ]);
  });

  it("scans a project and returns versioned, actionable results", async () => {
    const rootDir = await createWorkspaceFixture({
      kind: "none",
      packages: [{ path: ".", preset: "next" }],
    });
    const { client } = await connect([rootDir]);

    const { isError, payload } = await callTool(client, "scan");
    const result = payload as Record<string, unknown>;

    expect(isError).toBe(false);
    expect(typeof result.score).toBe("number");
    expect(result.grade).not.toBeNull();
    expect(result.rulesetVersion).toMatch(RULESET_VERSION_PATTERN);
    expect(result.schemaVersion).toBeGreaterThanOrEqual(9);
    expect(Array.isArray(result.actionables)).toBe(true);
    expect((result.actionables as unknown[]).length).toBeGreaterThan(0);
    // Compact mode omits raw findings.
    expect(result.findings).toBeNull();
  });

  it("narrows results with category and severity filters", async () => {
    const rootDir = await createWorkspaceFixture({
      kind: "none",
      packages: [{ path: ".", preset: "next" }],
    });
    const { client } = await connect([rootDir]);

    const all = await callTool(client, "scan");
    const filtered = await callTool(client, "scan", {
      category: "foundation",
    });
    const allActionables = (all.payload as { actionables: unknown[] })
      .actionables;
    const filteredActionables = (
      filtered.payload as { actionables: { category: string }[] }
    ).actionables;

    expect(filteredActionables.length).toBeLessThan(allActionables.length);
    expect(
      filteredActionables.every((entry) => entry.category === "foundation")
    ).toBe(true);
  });

  it("returns full findings with roasts stripped when asked", async () => {
    const rootDir = await createWorkspaceFixture({
      kind: "none",
      packages: [{ path: ".", preset: "next" }],
    });
    const { client } = await connect([rootDir]);

    const { payload } = await callTool(client, "scan", { full: true });
    const findings = (payload as { findings: { roast: string | null }[] })
      .findings;

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.roast === null)).toBe(true);
  });

  it("rejects paths outside the configured roots", async () => {
    const rootDir = await createWorkspaceFixture({
      kind: "none",
      packages: [{ path: ".", preset: "next" }],
    });
    const { client } = await connect([rootDir]);

    const escaped = await callTool(client, "scan", { path: "../.." });
    const absolute = await callTool(client, "scan", { path: "/etc" });

    expect(escaped.isError).toBe(true);
    expect(escaped.text).toMatch(OUTSIDE_ROOTS_PATTERN);
    expect(absolute.isError).toBe(true);
  });

  it("returns identical bodies for identical calls", async () => {
    const rootDir = await createWorkspaceFixture({
      kind: "none",
      packages: [{ path: ".", preset: "next" }],
    });
    const { client } = await connect([rootDir]);

    const first = await callTool(client, "scan");
    const second = await callTool(client, "scan");

    expect(second.text).toBe(first.text);
  });

  it("lists workspace projects with classifications", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "packages/ui", preset: "library" },
      ],
    });
    const { client } = await connect([rootDir]);

    const { payload } = await callTool(client, "list_projects");
    const result = payload as {
      kind: string;
      projects: { kind: string; packageDir: string }[];
    };

    expect(result.kind).toBe("pnpm");
    expect(result.projects.map((project) => project.packageDir)).toEqual([
      "apps/web",
      "packages/ui",
    ]);
    expect(result.projects[0]?.kind).toBe("application");
    expect(result.projects[1]?.kind).toBe("library");
  });

  it("filters a workspace scan by packageDir and names unknown ones", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
      ],
    });
    const { client } = await connect([rootDir]);

    const filtered = await callTool(client, "scan", {
      packageDir: "apps/web",
    });
    const filteredResult = filtered.payload as {
      actionables: { packageDir: string }[];
      workspace: { applicationCount: number };
    };

    expect(filtered.isError).toBe(false);
    expect(filteredResult.workspace.applicationCount).toBe(2);
    expect(
      filteredResult.actionables.every(
        (entry) => entry.packageDir === "apps/web"
      )
    ).toBe(true);

    const unknown = await callTool(client, "scan", { packageDir: "apps/nope" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("apps/web");
  });

  it("explains a rule and suggests near misses for unknown ids", async () => {
    const rootDir = await createWorkspaceFixture({
      kind: "none",
      packages: [{ path: ".", preset: "next" }],
    });
    const { client } = await connect([rootDir]);

    const known = await callTool(client, "explain_rule", {
      ruleId: "theme-provider-configured",
    });
    const knownResult = known.payload as { category: string; id: string };

    expect(known.isError).toBe(false);
    expect(knownResult.id).toBe("theme-provider-configured");
    expect(knownResult.category).toBe("foundation");

    const unknown = await callTool(client, "explain_rule", {
      ruleId: "theme-provider",
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("theme-provider-configured");
  });
});
