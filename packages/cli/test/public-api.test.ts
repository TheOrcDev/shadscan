import { describe, expect, it } from "vitest";

describe("public library API", () => {
  it("exports the safe scan surface without the custom-rule runner", async () => {
    const publicApi = await import("../src/index");

    expect(publicApi.scanProject).toBeTypeOf("function");
    expect(publicApi.renderAgentPrompt).toBeTypeOf("function");
    expect(publicApi.AuditReportSchema).toBeDefined();
    expect(publicApi).not.toHaveProperty("runAudit");
  });
});
