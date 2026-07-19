import { describe, expect, it } from "vitest";
import { GET as getAgentInstructions } from "../../app/agent.md/route";
import { GET as getOpenApiDocument } from "../../app/openapi.json/route";
import {
  AGENT_INSTRUCTIONS_MARKDOWN,
  HOSTED_SCAN_MAX_DURATION_SECONDS,
  SHADSCAN_AGENT_INSTRUCTIONS_URL,
  SHADSCAN_OPENAPI_URL,
  SHADSCAN_SCAN_ENDPOINT,
  SNAPSHOT_MAX_COMPRESSED_MEBIBYTES,
} from "../../lib/shadscan-api/agent-instructions";
import {
  OPENAPI_DOCUMENT,
  OPENAPI_VERSION,
} from "../../lib/shadscan-api/openapi";
import {
  JSON_MEDIA_TYPE,
  MARKDOWN_MEDIA_TYPE,
  PUBLIC_CONTRACT_VERSIONS,
  SNAPSHOT_MEDIA_TYPE,
} from "../../lib/shadscan-api/protocol";

const LOCAL_ABSOLUTE_PATH_PATTERN = /\/Users\/|[A-Za-z]:\\/;

describe("hosted API agent instructions", () => {
  it("documents both safe source workflows and the remediation loop", () => {
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain(SHADSCAN_SCAN_ENDPOINT);
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain(SHADSCAN_OPENAPI_URL);
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain("public GitHub repository");
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain(SNAPSHOT_MEDIA_TYPE);
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain(
      `must not exceed ${SNAPSHOT_MAX_COMPRESSED_MEBIBYTES} MiB`
    );
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain(
      `at most ${HOSTED_SCAN_MAX_DURATION_SECONDS} seconds`
    );
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain("$SHADSCAN_API_KEY");
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain("handoff.promptMarkdown");
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain(
      "Create a fresh sanitized snapshot"
    );
  });

  it("does not embed credentials or local workspace paths", () => {
    expect(AGENT_INSTRUCTIONS_MARKDOWN).not.toContain("shadscan_beta_");
    expect(AGENT_INSTRUCTIONS_MARKDOWN).not.toMatch(
      LOCAL_ABSOLUTE_PATH_PATTERN
    );
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain("--exclude='.env'");
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain("--exclude='node_modules'");
  });
});

describe("hosted API OpenAPI document", () => {
  it("describes both scan request bodies and negotiated success responses", () => {
    const operation = OPENAPI_DOCUMENT.paths["/v1/scans"].post;
    const success = operation.responses["200"];

    expect(OPENAPI_DOCUMENT.openapi).toBe(OPENAPI_VERSION);
    expect(OPENAPI_DOCUMENT.externalDocs.url).toBe(
      SHADSCAN_AGENT_INSTRUCTIONS_URL
    );
    expect(operation.security).toEqual([{ bearerAuth: [] }]);
    expect(operation.requestBody.content).toHaveProperty(JSON_MEDIA_TYPE);
    expect(operation.requestBody.content).toHaveProperty(SNAPSHOT_MEDIA_TYPE);
    expect(success.content).toHaveProperty(JSON_MEDIA_TYPE);
    expect(success.content).toHaveProperty(MARKDOWN_MEDIA_TYPE);
    expect(success.headers).toHaveProperty("RateLimit-Limit");
    expect(success.headers).toHaveProperty("RateLimit-Remaining");
    expect(success.headers).toHaveProperty("RateLimit-Reset");
  });

  it("publishes versioned report, prompt, scan, auth, and error contracts", () => {
    const schemas = OPENAPI_DOCUMENT.components.schemas;
    const responses = OPENAPI_DOCUMENT.paths["/v1/scans"].post.responses;

    expect(
      OPENAPI_DOCUMENT.components.securitySchemes.bearerAuth
    ).toMatchObject({ scheme: "bearer", type: "http" });
    expect(schemas.AuditReport.properties.schemaVersion.const).toBe(
      PUBLIC_CONTRACT_VERSIONS.report
    );
    expect(
      schemas.HostedScanResponse.properties.handoff.properties.promptVersion
        .const
    ).toBe(PUBLIC_CONTRACT_VERSIONS.prompt);
    expect(schemas.HostedScanResponse.properties.schemaVersion.const).toBe(
      PUBLIC_CONTRACT_VERSIONS.scan
    );
    expect(schemas.ActionableDisposition.enum).toEqual([
      "decide",
      "fix",
      "verify",
    ]);
    expect(schemas.AgentHandoff.required).toEqual(
      expect.arrayContaining(["verification", "workItems"])
    );
    expect(schemas.AgentWorkItem.required).toEqual(
      expect.arrayContaining(["disposition", "findingIds", "rawScoreImpact"])
    );
    expect(responses).toHaveProperty("400");
    expect(responses).toHaveProperty("401");
    expect(responses).toHaveProperty("413");
    expect(responses).toHaveProperty("422");
    expect(responses).toHaveProperty("429");
    expect(responses["429"].headers).toHaveProperty("Retry-After");
  });
});

describe("hosted API discovery routes", () => {
  it("serves the agent guide as cacheable Markdown", async () => {
    const response = getAgentInstructions();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("link")).toContain(SHADSCAN_OPENAPI_URL);
    await expect(response.text()).resolves.toBe(AGENT_INSTRUCTIONS_MARKDOWN);
  });

  it("serves the same OpenAPI document as JSON", async () => {
    const response = getOpenApiDocument();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("link")).toContain(
      SHADSCAN_AGENT_INSTRUCTIONS_URL
    );
    await expect(response.json()).resolves.toEqual(OPENAPI_DOCUMENT);
  });
});
