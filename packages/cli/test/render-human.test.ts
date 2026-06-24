import { describe, expect, it } from "vitest";
import type { AuditReport } from "../src/audit";
import { renderHumanReport, stripRoasts } from "../src/render-human";

const createReport = (): AuditReport => ({
  agentHandoff: {
    actionables: [
      {
        acceptanceCriteria: [
          "The Shadscan finding `metadata-configured` reports pass.",
        ],
        category: "foundation",
        confidence: "high",
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
          "Fix metadata configured; Shadscan marked this as a high-confidence missing UI fundamental.",
        title: "Fix metadata configured",
      },
    ],
    context: [
      "Adapter: next-app-router",
      "Package manager: pnpm",
      "shadcn confidence: high; config: /tmp/components.json",
      "Warnings: none",
    ],
    goal: "Raise demo's Shadscan score from 50/100 (F) by addressing agent-ready UI audit findings.",
    suggestedSkills: ["shadscan"],
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
  score: 50,
  shadcn: {
    confidence: "high",
    configPath: "/tmp/components.json",
    style: "new-york",
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

    expect(output).toContain("Your Shadscan score: 50/100");
    expect(output).toContain("Foundation: [########--------] 10/20 (50%)");
    expect(output).toContain("Missing: metadata configured");
    expect(output).toContain("Agent handoff:");
    expect(output).toContain("Suggested skills: shadscan");
    expect(output).toContain("1. [P1] Fix metadata configured");
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
});

describe("stripRoasts", () => {
  it("removes roast copy from JSON-safe reports", () => {
    const report = stripRoasts(createReport());

    expect(report.findings[0]?.roast).toBeNull();
  });
});
