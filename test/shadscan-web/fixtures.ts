import {
  AGENT_PROMPT_VERSION,
  AUDIT_REPORT_SCHEMA_VERSION,
  BUNDLED_RULESET_VERSION,
  ENGINE_VERSION,
} from "@shadscan/cli";
import type { WebScanCompleteState } from "@/lib/shadscan-web/types";

const THEME_SHORTCUT_EVIDENCE = [
  {
    filePath: "components/theme-shortcut.tsx",
    line: 12,
    message: "No safe dark-mode keyboard shortcut was found.",
  },
];

const EMPTY_STATE_EVIDENCE = [
  {
    filePath: "app/projects/page.tsx",
    message: "A collection route was found without a recognizable empty state.",
  },
];

const WEB_SCAN_COMPLETE_FIXTURE = {
  projectPath: ".",
  repository: "acme/widget",
  repositoryUrl: "https://github.com/acme/widget",
  result: {
    handoff: {
      promptMarkdown: "You are improving acme/widget from a shadscan audit.",
      promptVersion: AGENT_PROMPT_VERSION,
    },
    report: {
      agentHandoff: {
        actionables: [
          {
            acceptanceCriteria: [
              "Pressing D toggles the active theme outside editable controls.",
              "The shortcut ignores inputs, textareas, selects, and contenteditable nodes.",
            ],
            category: "interaction",
            confidence: "high",
            disposition: "fix",
            evidence: THEME_SHORTCUT_EVIDENCE,
            findingId: "interaction.theme-shortcut",
            priority: "P1",
            scoreImpact: 4,
            severity: "warning",
            status: "fail",
            suggestedFix:
              "Add a D shortcut that toggles the theme and ignores editable controls.",
            summary: "A keyboard shortcut for theme switching is missing.",
            title: "Add a dark-mode shortcut",
          },
          {
            acceptanceCriteria: [
              "Every collection route shows a purposeful empty state when no records exist.",
            ],
            category: "states",
            confidence: "medium",
            disposition: "verify",
            evidence: EMPTY_STATE_EVIDENCE,
            findingId: "states.empty-states",
            priority: "P2",
            scoreImpact: 0,
            severity: "info",
            status: "advisory",
            suggestedFix:
              "Verify the route behavior, then add an empty state where the collection can be empty.",
            summary: "One collection route may not explain its empty state.",
            title: "Verify collection empty states",
          },
        ],
        context: ["Framework: Next.js App Router", "Package manager: pnpm"],
        goal: "Raise widget's shadscan score from 72/100 (C).",
        suggestedSkills: ["shadcn"],
        verification: {
          projectGates: ["pnpm check", "pnpm build"],
          shadscanCommand: `pnpm dlx @shadscan/cli@${ENGINE_VERSION} --json`,
        },
        workItems: [
          {
            acceptanceCriteria: [
              "Pressing D toggles the active theme outside editable controls.",
              "The shortcut ignores inputs, textareas, selects, and contenteditable nodes.",
            ],
            categories: ["interaction"],
            disposition: "fix",
            evidence: THEME_SHORTCUT_EVIDENCE,
            findingIds: ["interaction.theme-shortcut"],
            id: "interaction.theme-shortcut",
            priority: "P1",
            rawScoreImpact: 4,
            suggestedFixes: [
              "Add a D shortcut that toggles the theme and ignores editable controls.",
            ],
            summary: "A keyboard shortcut for theme switching is missing.",
            title: "Add a dark-mode shortcut",
          },
          {
            acceptanceCriteria: [
              "Record the finding as confirmed, verified-no-change, or unable-to-verify.",
            ],
            categories: ["states"],
            disposition: "verify",
            evidence: EMPTY_STATE_EVIDENCE,
            findingIds: ["states.empty-states"],
            id: "states.empty-states",
            priority: "P2",
            rawScoreImpact: 0,
            suggestedFixes: [
              "Verify the route behavior, then add an empty state where the collection can be empty.",
            ],
            summary: "One collection route may not explain its empty state.",
            title: "Verify collection empty states",
          },
        ],
      },
      categories: [
        {
          applicable: true,
          id: "foundation",
          maxScore: 20,
          percentage: 90,
          score: 18,
          title: "Foundation",
          weight: 20,
        },
        {
          applicable: true,
          id: "interaction",
          maxScore: 20,
          percentage: 13,
          score: 2.608_695_652_173_913,
          title: "Interaction",
          weight: 20,
        },
        {
          applicable: true,
          id: "states",
          maxScore: 20,
          percentage: 80,
          score: 16,
          title: "States",
          weight: 20,
        },
        {
          applicable: true,
          id: "accessibility",
          maxScore: 20,
          percentage: 70,
          score: 14,
          title: "Accessibility",
          weight: 20,
        },
        {
          applicable: true,
          id: "forms",
          maxScore: 10,
          percentage: 100,
          score: 10,
          title: "Forms and Data Entry",
          weight: 10,
        },
        {
          applicable: true,
          id: "production-polish",
          maxScore: 10,
          percentage: 60,
          score: 6,
          title: "Production Polish",
          weight: 10,
        },
      ],
      coverage: {
        source: "complete",
      },
      durationMs: 1420,
      engineVersion: ENGINE_VERSION,
      findings: [
        {
          category: "interaction",
          confidence: "high",
          description: "Theme switching should be available from the keyboard.",
          evidence: THEME_SHORTCUT_EVIDENCE,
          id: "interaction.theme-shortcut",
          impactsScore: true,
          maxScore: 4,
          remediation:
            "Add a D shortcut that toggles the theme and ignores editable controls.",
          roast: "Pathetic. Pressing a button manually in 2026?",
          score: 0,
          severity: "warning",
          status: "fail",
          title: "Dark-mode shortcut is present",
        },
        {
          category: "states",
          confidence: "medium",
          description:
            "Collection routes should explain when no records exist.",
          evidence: EMPTY_STATE_EVIDENCE,
          id: "states.empty-states",
          impactsScore: false,
          maxScore: 0,
          remediation: "Verify the route and add an empty state if needed.",
          roast: "Blank screens are not a product strategy.",
          score: 0,
          severity: "info",
          status: "advisory",
          title: "Collection routes have empty states",
        },
        {
          category: "foundation",
          confidence: "high",
          description: "The application configures a theme provider.",
          evidence: [
            {
              filePath: "app/layout.tsx",
              line: 42,
              message: "ThemeProvider wraps the application shell.",
            },
          ],
          id: "foundation.theme-provider",
          impactsScore: true,
          maxScore: 4,
          remediation: null,
          roast: null,
          score: 4,
          severity: "warning",
          status: "pass",
          title: "Theme provider is configured",
        },
        {
          category: "forms",
          confidence: "high",
          description: "No forms were discovered in the scanned scope.",
          evidence: [],
          id: "forms.validation",
          impactsScore: false,
          maxScore: 0,
          remediation: null,
          roast: null,
          score: 0,
          severity: "warning",
          status: "not-applicable",
          title: "Forms use validation",
        },
      ],
      framework: {
        adapter: "next-app-router",
        evidence: ["app/layout.tsx", "next.config.ts"],
      },
      grade: "C",
      maxScore: 100,
      packageManager: "pnpm",
      packageName: "widget",
      rulesetVersion: BUNDLED_RULESET_VERSION,
      schemaVersion: AUDIT_REPORT_SCHEMA_VERSION,
      scope: {
        categories: [
          "foundation",
          "interaction",
          "states",
          "accessibility",
          "forms",
          "production-polish",
        ],
      },
      score: 72,
      shadcn: {
        confidence: "high",
        configPath: "components.json",
        style: "new-york",
      },
      source: {
        digest:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        kind: "snapshot",
        revision: "0123456789abcdef0123456789abcdef01234567",
      },
      versions: {
        next: "16.2.10",
        react: "19.2.4",
        vite: null,
      },
      warnings: ["components.json exists but could not be fully inspected."],
    },
    scan: {
      engineVersion: ENGINE_VERSION,
      id: "scan_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      resolvedRevision: "0123456789abcdef0123456789abcdef01234567",
      rulesetVersion: BUNDLED_RULESET_VERSION,
      sourceDigest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      status: "completed",
    },
    schemaVersion: 1,
  },
  status: "complete",
} satisfies WebScanCompleteState;

export { WEB_SCAN_COMPLETE_FIXTURE };
