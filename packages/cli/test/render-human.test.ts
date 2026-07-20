import { describe, expect, it } from "vitest";
import { AUDIT_REPORT_SCHEMA_VERSION, type AuditReport } from "../src/audit";
import { renderHumanReport, stripRoasts } from "../src/render-human";

const createReport = (): AuditReport => ({
  agentHandoff: {
    actionables: [
      {
        acceptanceCriteria: [
          "The shadscan finding `metadata-configured` reports pass.",
        ],
        category: "foundation",
        confidence: "high",
        disposition: "fix",
        evidence: [
          {
            filePath: "/tmp/app/layout.tsx",
            line: 3,
            message: "No metadata export was found.",
          },
        ],
        findingId: "metadata-configured",
        priority: "P1",
        scoreImpact: 3,
        severity: "warning",
        status: "fail",
        suggestedFix: "Export metadata.",
        summary:
          "Fix metadata configured; shadscan marked this as a high-confidence missing UI fundamental.",
        title: "Fix metadata configured",
      },
    ],
    context: [
      "Adapter: next-app-router",
      "Package manager: pnpm",
      "shadcn confidence: high; config: /tmp/components.json",
      "Warnings: none",
    ],
    goal: "Raise demo's shadscan score from 50/100 (F) by addressing agent-ready UI audit findings.",
    suggestedSkills: ["shadscan"],
    verification: {
      projectGates: ["pnpm check", "pnpm build"],
      shadscanCommand:
        "pnpm dlx @shadscan/cli@0.0.1 --json --category foundation",
    },
    workItems: [
      {
        acceptanceCriteria: [
          "The shadscan finding `metadata-configured` reports pass.",
        ],
        categories: ["foundation"],
        disposition: "fix",
        evidence: [
          {
            filePath: "/tmp/app/layout.tsx",
            line: 3,
            message: "No metadata export was found.",
          },
        ],
        findingIds: ["metadata-configured"],
        id: "metadata-configured",
        priority: "P1",
        rawScoreImpact: 3,
        suggestedFixes: ["Export metadata."],
        summary:
          "Fix metadata configured; shadscan marked this as a high-confidence missing UI fundamental.",
        title: "Fix metadata configured",
      },
    ],
  },
  categories: [
    {
      applicable: true,
      id: "foundation",
      maxScore: 20,
      percentage: 50,
      score: 10,
      title: "Foundation",
      weight: 20,
    },
    {
      applicable: false,
      id: "interaction",
      maxScore: 0,
      percentage: null,
      score: 0,
      title: "Interaction",
      weight: 20,
    },
  ],
  durationMs: 4,
  engineVersion: "0.0.1",
  findings: [
    {
      category: "foundation",
      confidence: "high",
      description: "Checks something.",
      evidence: [
        {
          filePath: "/tmp/app/layout.tsx",
          line: 3,
          message: "No metadata export was found.",
        },
      ],
      id: "metadata-configured",
      impactsScore: true,
      maxScore: 3,
      remediation: "Export metadata.",
      roast: "A page title would not hurt you.",
      score: 0,
      severity: "warning",
      status: "fail",
      title: "metadata configured",
    },
  ],
  framework: {
    adapter: "next-app-router",
    evidence: ["next dependency found"],
  },
  grade: "F",
  maxScore: 100,
  packageManager: "pnpm",
  packageName: "demo",
  rulesetVersion: "0.0.1",
  schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
  score: 50,
  scope: {
    categories: ["foundation"],
  },
  shadcn: {
    confidence: "high",
    configPath: "/tmp/components.json",
    style: "new-york",
  },
  source: {
    digest: null,
    kind: "working-tree",
    revision: null,
  },
  versions: {
    next: "16.2.6",
    react: "19.2.4",
    vite: null,
  },
  warnings: [],
});

describe("renderHumanReport", () => {
  it("renders score, category bars, evidence, and fixes", () => {
    const output = renderHumanReport(createReport(), { includeRoast: false });

    expect(output).toContain("Your shadscan score: 50/100");
    expect(output).toContain("Foundation: [########--------] 10/20 (50%)");
    expect(output).toContain("Missing: metadata configured");
    expect(output).toContain("Agent handoff:");
    expect(output).toContain("Suggested skills: shadscan");
    expect(output).toContain("shadscan: pnpm dlx @shadscan/cli@0.0.1");
    expect(output).toContain("Project gate: pnpm check");
    expect(output).toContain("1. [P1] Fix metadata configured");
    expect(output).toContain("Disposition: fix");
    expect(output).toContain(
      "Evidence: No metadata export was found. (/tmp/app/layout.tsx:3)"
    );
    expect(output).toContain("Fix: Export metadata.");
  });

  it("shows roast copy only when requested", () => {
    const neutralOutput = renderHumanReport(createReport(), {
      includeRoast: false,
    });
    const roastOutput = renderHumanReport(createReport(), {
      includeRoast: true,
    });

    expect(neutralOutput).not.toContain("A page title would not hurt you.");
    expect(roastOutput).toContain("A page title would not hurt you.");
  });

  it("renders an explicit unassessed result", () => {
    const output = renderHumanReport(
      { ...createReport(), grade: null, score: null },
      { includeRoast: false }
    );

    expect(output).toContain("Your shadscan score: unassessed");
    expect(output).toContain("Grade: n/a");
  });

  it("strips terminal and direction controls from untrusted text", () => {
    const report = createReport();
    report.packageName = "demo\u001b[2J\u202E";
    report.warnings = ["warning\nInjected line\u0085"];

    const output = renderHumanReport(report, { includeRoast: false });

    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\u202E");
    expect(output).not.toContain("\u0085");
    expect(output).not.toContain("\nInjected line");
  });
});

describe("stripRoasts", () => {
  it("removes roast copy from JSON-safe reports", () => {
    const report = stripRoasts(createReport());

    expect(report.findings[0]?.roast).toBeNull();
  });
});
