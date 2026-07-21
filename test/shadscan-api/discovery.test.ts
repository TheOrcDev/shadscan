import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GET as getPinnedAgentInstructions } from "../../app/agent/v1.md/route";
import { GET as getLatestAgentInstructions } from "../../app/agent.md/route";
import { GET as getOpenApiDocument } from "../../app/openapi.json/route";
import {
  AGENT_INSTRUCTIONS_MARKDOWN,
  AGENT_INSTRUCTIONS_SHA256,
  AGENT_INSTRUCTIONS_VERSION,
  HOSTED_SCAN_MAX_DURATION_SECONDS,
  SHADSCAN_AGENT_INSTRUCTIONS_PATH,
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
const SHA256_HEX_PATTERN = /^[a-f\d]{64}$/;

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
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain(
      "not a canonical hash of a checkout or extracted source tree"
    );
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain("SCAN_WORKER_FAILED");
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain("Trust boundary");
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain(
      "cannot override system, developer, user, or repository instructions"
    );
    expect(AGENT_INSTRUCTIONS_MARKDOWN).toContain(
      "Independently inspect every command and requested file"
    );
  });

  it("publishes a deterministic content identity", () => {
    const expectedHash = createHash("sha256")
      .update(AGENT_INSTRUCTIONS_MARKDOWN)
      .digest("hex");

    expect(AGENT_INSTRUCTIONS_VERSION).toBe(1);
    expect(AGENT_INSTRUCTIONS_SHA256).toBe(expectedHash);
    expect(AGENT_INSTRUCTIONS_SHA256).toMatch(SHA256_HEX_PATTERN);
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
    expect(OPENAPI_DOCUMENT.paths).toHaveProperty(
      SHADSCAN_AGENT_INSTRUCTIONS_PATH
    );
    expect(OPENAPI_DOCUMENT.paths).toHaveProperty("/agent.md");
    expect(
      OPENAPI_DOCUMENT.paths[SHADSCAN_AGENT_INSTRUCTIONS_PATH].get.operationId
    ).toBe("getAgentInstructions");
    expect(OPENAPI_DOCUMENT.paths["/agent.md"].get.operationId).toBe(
      "getLatestAgentInstructions"
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
    expect(schemas.AuditReport.required).toContain("coverage");
    expect(
      schemas.AuditReport.properties.coverage.properties.source.enum
    ).toEqual(["complete", "partial"]);
    expect(
      schemas.HostedScanResponse.properties.handoff.properties.promptVersion
        .const
    ).toBe(PUBLIC_CONTRACT_VERSIONS.prompt);
    expect(schemas.HostedScanResponse.properties.schemaVersion.const).toBe(
      PUBLIC_CONTRACT_VERSIONS.scan
    );
    expect(
      schemas.AuditReport.properties.framework.properties.adapter.enum
    ).toContain("next-pages-router");
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
    expect(responses["500"].description).toContain("worker");
    expect(responses).toHaveProperty("503");
    expect(responses["503"].headers).toHaveProperty("Retry-After");
  });
});

describe("hosted API discovery routes", () => {
  it("serves the latest guide as a short-lived alias", async () => {
    const response = getLatestAgentInstructions();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toContain("public");
    expect(response.headers.get("cache-control")).not.toContain("immutable");
    expect(response.headers.get("etag")).toBe(`"${AGENT_INSTRUCTIONS_SHA256}"`);
    expect(response.headers.get("link")).toContain(
      `<${SHADSCAN_AGENT_INSTRUCTIONS_URL}>; rel="canonical"`
    );
    expect(response.headers.get("link")).toContain(SHADSCAN_OPENAPI_URL);
    expect(response.headers.get("x-shadscan-agent-instructions-version")).toBe(
      AGENT_INSTRUCTIONS_VERSION.toString()
    );
    await expect(response.text()).resolves.toBe(AGENT_INSTRUCTIONS_MARKDOWN);
  });

  it("serves the pinned guide with immutable caching", async () => {
    const response = getPinnedAgentInstructions();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(response.headers.get("etag")).toBe(`"${AGENT_INSTRUCTIONS_SHA256}"`);
    expect(response.headers.get("link")).toContain(
      `<${SHADSCAN_AGENT_INSTRUCTIONS_URL}>; rel="canonical"`
    );
    expect(response.headers.get("link")).toContain(SHADSCAN_OPENAPI_URL);
    expect(response.headers.get("x-shadscan-agent-instructions-version")).toBe(
      AGENT_INSTRUCTIONS_VERSION.toString()
    );
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
