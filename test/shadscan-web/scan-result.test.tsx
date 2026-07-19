import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionablesReport, FindingsReport } from "@/app/scan/result-details";
import { ScanResult } from "@/app/scan/scan-result";
import { WEB_SCAN_COMPLETE_FIXTURE } from "./fixtures";

const { agentHandoff, findings } = WEB_SCAN_COMPLETE_FIXTURE.result.report;

describe("ScanResult", () => {
  it("renders score metadata, category progress, warnings, and result tabs", () => {
    const markup = renderToStaticMarkup(
      <ScanResult
        headingRef={createRef<HTMLHeadingElement>()}
        state={WEB_SCAN_COMPLETE_FIXTURE}
      />
    );

    expect(markup).toContain("72/100");
    expect(markup).toContain("Grade C");
    expect(markup).toContain("Category scores");
    expect(markup).toContain("Interaction: 2.6/20 (13%)");
    expect(markup).toContain("Scan warnings");
    expect(markup).toContain("Actionables (2)");
    expect(markup).toContain("All checks (4)");
    expect(markup).toContain("Copy agent handoff");
  });

  it("renders agent-ready actionable details with Typeset semantics", () => {
    const markup = renderToStaticMarkup(
      <ActionablesReport
        context={agentHandoff.context}
        findings={findings}
        suggestedSkills={agentHandoff.suggestedSkills}
        verification={agentHandoff.verification}
        workItems={agentHandoff.workItems}
      />
    );

    expect(markup).toContain("typeset typeset-report");
    expect(markup).toContain("P1");
    expect(markup).toContain("Fix");
    expect(markup).toContain("+4 raw rule points");
    expect(markup).toContain("components/theme-shortcut.tsx:12");
    expect(markup).toContain("Suggested approach");
    expect(markup).toContain("Acceptance criteria");
    expect(markup).toContain("Pathetic. Pressing a button manually in 2026?");
    expect(markup).toContain("Suggested skills");
    expect(markup).toContain("pnpm dlx shadscan@0.1.0-rc.1 --json");
  });

  it("renders every finding status and its evidence", () => {
    const markup = renderToStaticMarkup(<FindingsReport findings={findings} />);

    expect(markup).toContain("Failed");
    expect(markup).toContain("Advisory");
    expect(markup).toContain("Passed");
    expect(markup).toContain("Not applicable");
    expect(markup).toContain("interaction.theme-shortcut");
    expect(markup).toContain("ThemeProvider wraps the application shell.");
    expect(markup).toContain("No additional evidence was recorded.");
  });

  it("renders a purposeful empty state when no actionables remain", () => {
    const markup = renderToStaticMarkup(
      <ActionablesReport
        context={agentHandoff.context}
        findings={findings}
        suggestedSkills={agentHandoff.suggestedSkills}
        verification={agentHandoff.verification}
        workItems={[]}
      />
    );

    expect(markup).toContain("No actionables");
    expect(markup).toContain(
      "No missing UI fundamentals were found in this scan."
    );
  });
});
