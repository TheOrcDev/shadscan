import { afterEach, describe, expect, it } from "vitest";
import { BUNDLED_RULESET_VERSION, scanProject } from "../src/scan";
import { createRuleFixture } from "./rule-fixture";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

describe("scanProject", () => {
  it("always runs the bundled ruleset", async () => {
    const fixture = await createRuleFixture();
    cleanups.push(fixture.cleanup);

    const report = await scanProject(fixture.rootDir);

    expect(report.rulesetVersion).toBe(BUNDLED_RULESET_VERSION);
    expect(report.scope.categories).toEqual([
      "foundation",
      "interaction",
      "states",
      "accessibility",
      "forms",
      "production-polish",
    ]);
    expect(report.source).toEqual({
      digest: null,
      kind: "working-tree",
      revision: null,
    });
    expect(report.findings.length).toBeGreaterThan(0);
    expect(
      report.findings.some((finding) => finding.id === "shadcn-config-present")
    ).toBe(true);
  });

  it("records scan scope and source identity", async () => {
    const fixture = await createRuleFixture();
    cleanups.push(fixture.cleanup);

    const report = await scanProject(fixture.rootDir, {
      category: "accessibility",
      source: {
        digest: "sha256:abc123",
        kind: "git",
        revision: "0123456789abcdef",
      },
    });

    expect(report.scope.categories).toEqual(["accessibility"]);
    expect(report.source).toEqual({
      digest: "sha256:abc123",
      kind: "git",
      revision: "0123456789abcdef",
    });
  });
});
