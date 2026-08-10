import { describe, expect, it } from "vitest";
import { AGENT_AUDIT_PROMPT } from "../../lib/agent-prompt";

const LITERAL_URL_PATTERN = /https?:\/\//iu;
const DOMAIN_PATTERN = /\b(?:[a-z\d-]+\.)+(?:app|com|dev|io|net|org)\b/iu;
const BATCH_SIZE_PATTERN = /(?:10|ten) (?:unique )?pages/iu;
const DASHBOARD_ROUTE_PATTERN = /\/dashboard\b/iu;
const LOCAL_ENVIRONMENT_PATTERN = /\blocal(?:ly)?\b/iu;
const PRODUCTION_ENVIRONMENT_PATTERN = /\bproduction\b/iu;
const STOP_BEFORE_EDIT_PATTERN =
  /stop[\s\S]{0,160}approval[\s\S]{0,160}before (?:changing|editing)/iu;

describe("public agent audit prompt", () => {
  it("requests project-aware source and rendered checks without inventing targets", () => {
    expect(AGENT_AUDIT_PROMPT).toContain("--prompt");
    expect(AGENT_AUDIT_PROMPT).toContain("--check-overflow");
    expect(AGENT_AUDIT_PROMPT).toContain("--list-projects --json");
    expect(AGENT_AUDIT_PROMPT).toContain("--route");

    expect(AGENT_AUDIT_PROMPT).toContain("monorepo");
    expect(AGENT_AUDIT_PROMPT).toContain(
      "audits every supported React application"
    );
    expect(AGENT_AUDIT_PROMPT).toContain("by default");

    expect(AGENT_AUDIT_PROMPT).toMatch(LOCAL_ENVIRONMENT_PATTERN);
    expect(AGENT_AUDIT_PROMPT).toMatch(PRODUCTION_ENVIRONMENT_PATTERN);
    expect(AGENT_AUDIT_PROMPT).toContain("batch");
    expect(AGENT_AUDIT_PROMPT).toMatch(BATCH_SIZE_PATTERN);
    expect(AGENT_AUDIT_PROMPT).toContain("verification.shadscanCommand");
    expect(AGENT_AUDIT_PROMPT).toContain('kind is "application"');
    expect(AGENT_AUDIT_PROMPT).toContain('kind is "overflow-check"');
    expect(AGENT_AUDIT_PROMPT).toContain("finalPath");
    expect(AGENT_AUDIT_PROMPT).toContain("httpStatus");
    expect(AGENT_AUDIT_PROMPT).toContain("public HTTPS origin");
    expect(AGENT_AUDIT_PROMPT).toContain("Never stop a reused");
    expect(AGENT_AUDIT_PROMPT).toContain("separate process argument");
    expect(AGENT_AUDIT_PROMPT).toContain("entire batch was not verified");
    expect(AGENT_AUDIT_PROMPT).toMatch(STOP_BEFORE_EDIT_PATTERN);

    expect(AGENT_AUDIT_PROMPT).not.toContain("localhost");
    expect(AGENT_AUDIT_PROMPT).not.toMatch(DASHBOARD_ROUTE_PATTERN);
    expect(AGENT_AUDIT_PROMPT).not.toMatch(LITERAL_URL_PATTERN);
    expect(AGENT_AUDIT_PROMPT).not.toMatch(DOMAIN_PATTERN);
  });
});
