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
      },
      null,
      2
    )}\n`
  );

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

  it("weights category scores and normalizes active categories to 100", async () => {
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
    expect(report.score).toBe(67);
    expect(report.grade).toBe("D");
    expect(report.agentHandoff.suggestedSkills).toEqual([
      "shadscan",
      "diagnose",
    ]);
    expect(
      report.agentHandoff.actionables.map((actionable) => ({
        findingId: actionable.findingId,
        priority: actionable.priority,
        scoreImpact: actionable.scoreImpact,
        status: actionable.status,
      }))
    ).toEqual([
      {
        findingId: "interaction-fail",
        priority: "P1",
        scoreImpact: 10,
        status: "fail",
      },
      {
        findingId: "states-advisory",
        priority: "P2",
        scoreImpact: 0,
        status: "advisory",
      },
    ]);
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
    expect(report.score).toBe(100);
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
    expect(report.score).toBe(100);
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
});

describe("createAuditReport", () => {
  it("returns full credit when no rules apply", () => {
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

    expect(report.score).toBe(100);
    expect(report.categories.every((category) => !category.applicable)).toBe(
      true
    );
  });
});
