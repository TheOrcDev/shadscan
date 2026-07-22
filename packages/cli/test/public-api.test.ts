import { describe, expect, it } from "vitest";

describe("public library API", () => {
  it("exports the safe scan surface without the custom-rule runner", async () => {
    const publicApi = await import("../src/index");

    expect(publicApi.scanProject).toBeTypeOf("function");
    expect(publicApi.renderAgentPrompt).toBeTypeOf("function");
    expect(publicApi.AuditReportSchema).toBeDefined();
    expect(publicApi.RULE_CATALOG).toHaveLength(56);
    expect(
      new Set(publicApi.RULE_CATALOG.map((rule) => rule.id))
    ).toHaveProperty("size", publicApi.RULE_CATALOG.length);
    expect(publicApi.RULE_CATALOG[0]).not.toHaveProperty("run");
    expect(publicApi).not.toHaveProperty("runAudit");
  });
});
