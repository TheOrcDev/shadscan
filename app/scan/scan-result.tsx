import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import type { RefObject } from "react";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WebScanCompleteState } from "@/lib/shadscan-web/types";
import {
  ActionablesReport,
  CategoryScores,
  FindingsReport,
  WarningsAlert,
} from "./result-details";

interface ScanResultProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  state: WebScanCompleteState;
}

const FRAMEWORK_LABELS = {
  "generic-react": "React",
  "next-app-router": "Next.js App Router",
  "next-hybrid-router": "Next.js App + Pages Router",
  "next-pages-router": "Next.js Pages Router",
  "vite-react": "Vite React",
} as const satisfies Record<
  WebScanCompleteState["result"]["report"]["framework"]["adapter"],
  string
>;

const getScoreLabel = (score: number | null): string =>
  score === null ? "Unassessed" : `${score}/100`;

const getDurationLabel = (durationMs: number): string => {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(1)} s`;
};

function ScanMetadata({ state }: { state: WebScanCompleteState }) {
  const { report, scan } = state.result;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-1">
        <span className="font-heading font-medium text-4xl">
          {getScoreLabel(report.score)}
        </span>
        <span className="text-muted-foreground text-sm">
          Grade {report.grade ?? "not assigned"}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-2 text-sm">
        <a
          className="inline-flex min-w-0 items-center gap-1.5 font-medium hover:underline"
          href={state.repositoryUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span className="truncate">{state.repository}</span>
          <ArrowSquareOutIcon aria-hidden="true" className="shrink-0" />
        </a>
        <code className="truncate text-muted-foreground text-xs">
          {scan.resolvedRevision?.slice(0, 12) ?? "Revision unavailable"}
        </code>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Rules {scan.rulesetVersion}</Badge>
          <Badge variant="outline">
            {report.agentHandoff.workItems.length} work items
          </Badge>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Project</dt>
        <dd className="truncate text-right">
          {report.packageName ?? "Unnamed package"}
        </dd>
        <dt className="text-muted-foreground">Framework</dt>
        <dd className="text-right">
          {FRAMEWORK_LABELS[report.framework.adapter]}
        </dd>
        <dt className="text-muted-foreground">Package manager</dt>
        <dd className="text-right">{report.packageManager}</dd>
        <dt className="text-muted-foreground">Audit runtime</dt>
        <dd className="text-right">{getDurationLabel(report.durationMs)}</dd>
      </dl>

      <CategoryScores categories={report.categories} />
    </div>
  );
}

function ScanResult({ headingRef, state }: ScanResultProps) {
  const { report } = state.result;
  const actionableCount = report.agentHandoff.workItems.length;
  const findingCount = report.findings.length;

  return (
    <section
      aria-labelledby="scan-result-heading"
      className="grid min-h-80 gap-8 border-border border-t pt-8 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
    >
      <ScanMetadata state={state} />

      <div className="flex min-w-0 flex-col gap-6 lg:border-border lg:border-l lg:pl-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 basis-full flex-col gap-1 sm:basis-auto">
            <h2
              className="w-fit font-heading font-medium text-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              id="scan-result-heading"
              ref={headingRef}
              tabIndex={-1}
            >
              Scan complete
            </h2>
            <p className="text-muted-foreground text-sm">
              {report.agentHandoff.goal}
            </p>
          </div>
          <CopyButton
            aria-label="Copy agent handoff"
            size="sm"
            text={state.result.handoff.promptMarkdown}
            variant="outline"
          >
            Copy agent handoff
          </CopyButton>
        </div>

        <WarningsAlert warnings={report.warnings} />

        <Tabs className="min-w-0" defaultValue="actionables">
          <TabsList
            aria-label="Scan result views"
            className="w-full justify-start overflow-x-auto"
            variant="line"
          >
            <TabsTrigger value="actionables">
              Actionables ({actionableCount})
            </TabsTrigger>
            <TabsTrigger value="all-checks">
              All checks ({findingCount})
            </TabsTrigger>
          </TabsList>
          <TabsContent className="mt-6 min-w-0" value="actionables">
            <ActionablesReport
              context={report.agentHandoff.context}
              findings={report.findings}
              suggestedSkills={report.agentHandoff.suggestedSkills}
              verification={report.agentHandoff.verification}
              workItems={report.agentHandoff.workItems}
            />
          </TabsContent>
          <TabsContent className="mt-6 min-w-0" value="all-checks">
            <FindingsReport findings={report.findings} />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}

export { ScanResult };
