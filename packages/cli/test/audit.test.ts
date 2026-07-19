import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUDIT_REPORT_SCHEMA_VERSION,
  AuditReportSchema,
  type AuditRule,
  createAuditReport,
  ENGINE_VERSION,
  runAudit,
} from "../src/audit";
import type { ProjectDiscovery } from "../src/discovery";

const tempDirs: string[] = [];

const createFixture = async (): Promise<string> => {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "shadscan-audit-"));
  tempDirs.push(fixtureDir);

  return fixtureDir;
};

const writeFixtureFile = async (
  rootDir: string,
  filePath: string,
  content: string
): Promise<void> => {
  const absolutePath = path.join(rootDir, filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
};

const createReactFixture = async (): Promise<string> => {
  const rootDir = await createFixture();
  await writeFixtureFile(
    rootDir,
    "package.json",
    `${JSON.stringify(
      {
        dependencies: {
          react: "19.2.4",
        },
        name: "audit-fixture",
        scripts: {
          build: "vite build",
          check: "ultracite check",
        },
      },
      null,
      2
    )}\n`
  );
  await writeFixtureFile(rootDir, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");

  return rootDir;
};

const createRule = (overrides: Partial<AuditRule>): AuditRule => ({
  adapters: ["core"],
  category: "foundation",
  confidence: "high",
  description: "Test rule.",
  id: "test-rule",
  maxScore: 10,
  run: () => ({ status: "pass" }),
  severity: "warning",
  title: "Test rule",
  ...overrides,
});

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { force: true, recursive: true });
  }
});

describe("runAudit", () => {
  it("validates the JSON report contract", async () => {
    const rootDir = await createReactFixture();
    await writeFixtureFile(
      rootDir,
      "components.json",
      '{"style":"default","aliases":{}}\n'
    );

    const report = await runAudit(rootDir, {
      rules: [
        createRule({
          id: "passing-rule",
          run: () => ({
            evidence: [
              {
                filePath: path.join(rootDir, "src", "App.tsx"),
                line: 1,
                message: "App entry inspected.",
              },
            ],
            status: "pass",
          }),
        }),
      ],
      rulesetVersion: "test-rules-v1",
    });

    expect(() => AuditReportSchema.parse(report)).not.toThrow();
    expect(report.schemaVersion).toBe(AUDIT_REPORT_SCHEMA_VERSION);
    expect(report.engineVersion).toBe(ENGINE_VERSION);
    expect(report.rulesetVersion).toBe("test-rules-v1");
    expect(report.scope.categories).toEqual([
      "foundation",
      "interaction",
      "states",
      "accessibility",
      "forms",
      "production-polish",
    ]);
    expect(report.score).toBe(100);
    expect(report.grade).toBe("A");
    expect(report.framework.adapter).toBe("generic-react");
    expect(report.agentHandoff.actionables).toEqual([]);
    expect(report.agentHandoff.goal).toContain(
      "Keep audit-fixture's Shadscan score at 100/100"
    );
    expect(report.findings[0]?.evidence[0]?.filePath).toBe("src/App.tsx");
    expect(report.shadcn.configPath).toBe("components.json");
    expect(report.agentHandoff.context).toContain(
      "shadcn confidence: high; config: components.json"
    );
    expect(
      AuditReportSchema.safeParse({
        ...report,
        shadcn: { ...report.shadcn, configPath: "/tmp/components.json" },
      }).success
    ).toBe(false);
    expect(
      AuditReportSchema.safeParse({
        ...report,
        findings: [
          {
            ...report.findings[0],
            evidence: [
              {
                filePath: "..\\secret.txt",
                message: "Invalid path.",
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });

  it("does not expose evidence paths outside the project", async () => {
    const rootDir = await createReactFixture();

    const report = await runAudit(rootDir, {
      rules: [
        createRule({
          run: () => ({
            evidence: [
              {
                filePath: path.join(rootDir, "..", "secret.txt"),
                message: "External file inspected.",
              },
            ],
            status: "fail",
          }),
        }),
      ],
    });

    expect(report.findings[0]?.evidence).toEqual([
      { message: "External file inspected." },
    ]);
  });

  it("weights scored findings without letting advisories affect the denominator", async () => {
    const rootDir = await createReactFixture();

    const report = await runAudit(rootDir, {
      rules: [
        createRule({
          category: "foundation",
          id: "foundation-pass",
          run: () => ({ status: "pass" }),
        }),
        createRule({
          category: "interaction",
          id: "interaction-fail",
          run: () => ({ status: "fail" }),
        }),
        createRule({
          category: "states",
          confidence: "low",
          id: "states-advisory",
          run: () => ({ confidence: "low", status: "fail" }),
        }),
      ],
    });

    expect(report.findings.map((finding) => finding.status)).toEqual([
      "pass",
      "fail",
      "advisory",
    ]);
    expect(report.score).toBe(50);
    expect(report.grade).toBe("F");
    expect(
      report.categories.find((category) => category.id === "states")?.applicable
    ).toBe(false);
    expect(report.agentHandoff.suggestedSkills).toEqual([
      "shadscan",
      "diagnose",
    ]);
    expect(
      report.agentHandoff.actionables.map((actionable) => ({
        findingId: actionable.findingId,
        disposition: actionable.disposition,
        priority: actionable.priority,
        scoreImpact: actionable.scoreImpact,
        status: actionable.status,
      }))
    ).toEqual([
      {
        disposition: "fix",
        findingId: "interaction-fail",
        priority: "P1",
        scoreImpact: 10,
        status: "fail",
      },
      {
        disposition: "verify",
        findingId: "states-advisory",
        priority: "P2",
        scoreImpact: 0,
        status: "advisory",
      },
    ]);
    expect(report.agentHandoff.actionables[0]?.acceptanceCriteria[0]).toBe(
      "The Shadscan finding `interaction-fail` reports pass when rerun with the same ruleset and category scope."
    );
    expect(report.agentHandoff.actionables[1]?.acceptanceCriteria).toContain(
      "Do not edit solely to force a score-neutral static advisory to report pass; it may remain advisory after successful verification."
    );
    expect(report.agentHandoff.verification).toEqual({
      projectGates: ["pnpm check", "pnpm build"],
      shadscanCommand: `pnpm dlx shadscan@${ENGINE_VERSION} --json`,
    });
  });

  it("groups related fixes and marks optional infrastructure as a product decision", async () => {
    const rootDir = await createReactFixture();

    const report = await runAudit(rootDir, {
      rules: [
        createRule({
          category: "accessibility",
          id: "forms-have-labels",
          severity: "error",
          run: () => ({ status: "fail" }),
        }),
        createRule({
          category: "forms",
          id: "invalid-fields-associated-with-errors",
          severity: "error",
          run: () => ({ status: "fail" }),
        }),
        createRule({
          category: "interaction",
          id: "command-menu-present",
          run: () => ({ status: "fail" }),
        }),
        createRule({
          category: "interaction",
          id: "command-menu-hotkey-present",
          run: () => ({ status: "fail" }),
        }),
      ],
    });

    expect(
      report.agentHandoff.workItems.map((workItem) => ({
        disposition: workItem.disposition,
        findingIds: workItem.findingIds,
        id: workItem.id,
        priority: workItem.priority,
      }))
    ).toEqual([
      {
        disposition: "fix",
        findingIds: [
          "forms-have-labels",
          "invalid-fields-associated-with-errors",
        ],
        id: "form-field-accessibility",
        priority: "P0",
      },
      {
        disposition: "decide",
        findingIds: ["command-menu-present", "command-menu-hotkey-present"],
        id: "command-menu",
        priority: "P1",
      },
    ]);
    expect(report.agentHandoff.workItems[1]?.acceptanceCriteria).toContain(
      "Do not add unused infrastructure solely to increase the audit score."
    );
    expect(report.agentHandoff.goal).toContain(
      "making explicit product decisions"
    );
  });

  it("does not let low-confidence failures reduce the main score", async () => {
    const rootDir = await createReactFixture();

    const report = await runAudit(rootDir, {
      rules: [
        createRule({
          confidence: "low",
          id: "low-confidence-fail",
          run: () => ({ confidence: "low", status: "fail" }),
        }),
      ],
    });

    expect(report.findings[0]?.status).toBe("advisory");
    expect(report.findings[0]?.impactsScore).toBe(false);
    expect(report.score).toBeNull();
    expect(report.grade).toBeNull();
  });

  it("keeps a perfect-score handoff neutral when only advisories remain", async () => {
    const rootDir = await createReactFixture();

    const report = await runAudit(rootDir, {
      rules: [
        createRule({ id: "passing-rule" }),
        createRule({
          confidence: "low",
          id: "advisory-rule",
          run: () => ({ confidence: "low", status: "fail" }),
        }),
      ],
    });

    expect(report.score).toBe(100);
    expect(report.agentHandoff.goal).toContain(
      "while verifying the score-neutral advisories"
    );
    expect(report.agentHandoff.goal).not.toContain("Raise");
  });

  it("keeps zero-point rules outside score calculations", async () => {
    const rootDir = await createReactFixture();

    const report = await runAudit(rootDir, {
      rules: [
        createRule({
          id: "score-neutral-rule",
          maxScore: 0,
          run: () => ({ status: "pass" }),
        }),
      ],
    });

    expect(report.findings[0]?.impactsScore).toBe(false);
    expect(report.categories.every((category) => !category.applicable)).toBe(
      true
    );
    expect(report.score).toBeNull();
  });

  it("filters rules by adapter", async () => {
    const rootDir = await createReactFixture();

    const report = await runAudit(rootDir, {
      rules: [
        createRule({
          adapters: ["next-app-router"],
          id: "next-only",
          run: () => ({ status: "fail" }),
        }),
        createRule({
          adapters: ["generic-react"],
          id: "generic-only",
          run: () => ({ status: "pass" }),
        }),
      ],
    });

    expect(report.findings.map((finding) => finding.id)).toEqual([
      "generic-only",
    ]);
    expect(report.score).toBe(100);
  });

  it("filters rules by category", async () => {
    const rootDir = await createReactFixture();

    const report = await runAudit(rootDir, {
      category: "accessibility",
      rules: [
        createRule({
          category: "foundation",
          id: "foundation-rule",
          run: () => ({ status: "fail" }),
        }),
        createRule({
          category: "accessibility",
          id: "accessibility-rule",
          run: () => ({ status: "pass" }),
        }),
      ],
    });

    expect(report.findings.map((finding) => finding.id)).toEqual([
      "accessibility-rule",
    ]);
    expect(report.score).toBe(100);
  });

  it("rounds the overall weighted score only once", async () => {
    const rootDir = await createReactFixture();
    const categories = ["foundation", "interaction", "states"] as const;
    const rules = categories.flatMap((category) => [
      createRule({
        category,
        id: `${category}-pass`,
        run: () => ({ status: "pass" }),
      }),
      createRule({
        category,
        id: `${category}-fail-one`,
        run: () => ({ status: "fail" }),
      }),
      createRule({
        category,
        id: `${category}-fail-two`,
        run: () => ({ status: "fail" }),
      }),
    ]);

    const report = await runAudit(rootDir, { rules });

    expect(report.score).toBe(33);
    const activeCategoryScore = report.categories
      .filter((category) => category.applicable)
      .reduce((total, category) => total + category.score, 0);
    expect(activeCategoryScore).toBeCloseTo(20, 10);
  });
});

describe("createAuditReport", () => {
  it("returns an unassessed result when no scored rules apply", () => {
    const project: ProjectDiscovery = {
      dependencies: {},
      framework: {
        adapter: "generic-react",
        evidence: [],
      },
      packageManager: "unknown",
      packageName: null,
      paths: {
        appDir: null,
        packageJson: "/tmp/package.json",
        srcDir: null,
        tailwindCss: null,
        tsconfig: null,
        viteEntry: null,
      },
      rootDir: "/tmp",
      scripts: {},
      shadcn: {
        aliases: {},
        configPath: null,
        confidence: "low",
        style: null,
      },
      versions: {
        next: null,
        react: null,
        vite: null,
      },
      warnings: [],
    };

    const report = createAuditReport({
      durationMs: 0,
      findings: [],
      project,
    });

    expect(report.score).toBeNull();
    expect(report.grade).toBeNull();
    expect(report.agentHandoff.goal).toContain("score is unassessed");
    expect(report.categories.every((category) => !category.applicable)).toBe(
      true
    );
  });
});
