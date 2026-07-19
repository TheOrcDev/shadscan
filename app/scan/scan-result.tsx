import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import type { RefObject } from "react";
import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import type { WebScanCompleteState } from "@/lib/shadscan-web/types";

interface ScanResultProps {
  headingRef: RefObject<HTMLHeadingElement | null>;
  state: WebScanCompleteState;
}

const getScoreLabel = (score: number | null): string =>
  score === null ? "Unassessed" : `${score}/100`;

function ScanResult({ headingRef, state }: ScanResultProps) {
  const { report, scan } = state.result;

  return (
    <section
      aria-labelledby="scan-result-heading"
      className="grid min-h-80 gap-8 border-border border-t pt-8 lg:grid-cols-[minmax(0,18rem)_1fr]"
    >
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
              {report.agentHandoff.actionables.length} actionables
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-5 lg:border-border lg:border-l lg:pl-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2
              className="font-heading font-medium text-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

        <div className="flex flex-col gap-3">
          <h3 className="font-heading font-medium">Top actionables</h3>
          {report.agentHandoff.actionables.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No missing fundamentals were found.
            </p>
          ) : (
            <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
              {report.agentHandoff.actionables.slice(0, 5).map((actionable) => (
                <li className="pl-1" key={actionable.findingId}>
                  <span className="font-medium">{actionable.title}</span>
                  <span className="ml-2 text-muted-foreground">
                    {actionable.priority}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

export { ScanResult };
