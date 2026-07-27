import { describe, expect, it } from "vitest";
import { AUDIT_REPORT_SCHEMA_VERSION, type AuditReport } from "../src/audit";
import { renderBannerRows } from "../src/grade-banner";
import { renderHumanReport, stripRoasts } from "../src/render-human";
import type { TerminalCapabilities } from "../src/terminal-capabilities";

const PLAIN_TERMINAL = {
  color: false,
  columns: null,
  unicode: false,
} as const satisfies TerminalCapabilities;

const RICH_TERMINAL = {
  color: false,
  columns: 18,
  unicode: true,
} as const satisfies TerminalCapabilities;

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
  coverage: {
    source: "complete",
  },
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
    astro: null,
    inertia: null,
    laravel: null,
    next: "16.2.6",
    react: "19.2.4",
    reactRouter: null,
    tanstackStart: null,
    vite: null,
  },
  warnings: [],
});

describe("renderHumanReport", () => {
  it("renders score, category bars, evidence, and fixes", () => {
    const output = renderHumanReport(createReport(), {
      includeRoast: false,
      terminal: PLAIN_TERMINAL,
    });

    expect(output).toContain(
      "Your shadscan score: [########--------] 50/100 (Grade F)"
    );
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
      terminal: PLAIN_TERMINAL,
    });
    const roastOutput = renderHumanReport(createReport(), {
      includeRoast: true,
      terminal: PLAIN_TERMINAL,
    });

    expect(neutralOutput).not.toContain("A page title would not hurt you.");
    expect(roastOutput).toContain("A page title would not hurt you.");
  });

  it("renders an explicit unassessed result", () => {
    const output = renderHumanReport(
      { ...createReport(), grade: null, score: null },
      { includeRoast: false, terminal: PLAIN_TERMINAL }
    );

    expect(output).toContain("Your shadscan score: unassessed (Grade n/a)");
    expect(output).not.toContain("Your shadscan score: [");
  });

  it.each([
    { bar: "----------------", grade: "F", score: 0 },
    { bar: "########--------", grade: "F", score: 50 },
    { bar: "################", grade: "A", score: 100 },
  ] as const)("renders the plain score bar at $score", ({
    bar,
    grade,
    score,
  }) => {
    const output = renderHumanReport(
      { ...createReport(), grade, score },
      { includeRoast: false, terminal: PLAIN_TERMINAL }
    );

    expect(output).toContain(
      `Your shadscan score: [${bar}] ${score}/100 (Grade ${grade})`
    );
  });

  it("renders a Unicode score bar clamped to the TTY width", () => {
    const output = renderHumanReport(createReport(), {
      includeRoast: false,
      terminal: RICH_TERMINAL,
    });

    expect(output).toContain(
      "Your shadscan score: 50/100 (Grade F)\n  ████████░░░░░░░░\n"
    );
  });

  it.each([
    { colorCode: 32, grade: "A", score: 95 },
    { colorCode: 33, grade: "C", score: 75 },
    { colorCode: 31, grade: "F", score: 50 },
  ] as const)("colors score band $grade without replacing its text label", ({
    colorCode,
    grade,
    score,
  }) => {
    const output = renderHumanReport(
      { ...createReport(), grade, score },
      {
        includeRoast: false,
        terminal: { ...RICH_TERMINAL, color: true },
      }
    );

    expect(output).toContain(`\u001b[${colorCode}m${score}/100\u001b[39m`);
    expect(output).toContain(`Grade \u001b[${colorCode}m${grade}\u001b[39m`);
  });

  it("ends a wide local TTY report with the block grade banner", () => {
    const output = renderHumanReport(createReport(), {
      includeRoast: false,
      terminal: { color: false, columns: 80, unicode: true },
    });
    const lines = output.trimEnd().split("\n");
    const bannerLines = lines.slice(-6);
    // The report ends with the banner spelling "F 50/100".
    const expectedRows = renderBannerRows("F 50/100");

    expect(expectedRows).not.toBeNull();
    expect(bannerLines).toEqual((expectedRows ?? []).map((row) => `  ${row}`));
  });

  it("falls back to a single grade line when the TTY is too narrow", () => {
    const output = renderHumanReport(createReport(), {
      includeRoast: false,
      terminal: RICH_TERMINAL,
    });

    expect(output).toContain("Final grade: F 50/100");
    expect(output).not.toContain("╗");
  });

  it("omits the grade banner for plain terminals and unassessed runs", () => {
    const plainOutput = renderHumanReport(createReport(), {
      includeRoast: false,
      terminal: PLAIN_TERMINAL,
    });
    const unassessedOutput = renderHumanReport(
      { ...createReport(), grade: null, score: null },
      { includeRoast: false, terminal: { ...RICH_TERMINAL, columns: 80 } }
    );

    expect(plainOutput).not.toContain("Final grade:");
    expect(plainOutput).not.toContain("█");
    expect(unassessedOutput).not.toContain("Final grade:");
    expect(unassessedOutput).not.toContain("╗");
  });

  it("strips terminal and direction controls from untrusted text", () => {
    const report = createReport();
    report.packageName = "demo\u001b[2J\u202E";
    report.warnings = ["warning\nInjected line\u0085"];

    const output = renderHumanReport(report, {
      includeRoast: false,
      terminal: PLAIN_TERMINAL,
    });

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
