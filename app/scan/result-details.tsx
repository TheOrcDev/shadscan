import {
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Fragment } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { WebScanCompleteState } from "@/lib/shadscan-web/types";

type ScanReport = WebScanCompleteState["result"]["report"];
type WorkItem = ScanReport["agentHandoff"]["workItems"][number];
type CategoryScore = ScanReport["categories"][number];
type Evidence = ScanReport["findings"][number]["evidence"][number];
type Finding = ScanReport["findings"][number];
type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

interface ActionablesReportProps {
  context: ScanReport["agentHandoff"]["context"];
  findings: ScanReport["findings"];
  suggestedSkills: ScanReport["agentHandoff"]["suggestedSkills"];
  verification: ScanReport["agentHandoff"]["verification"];
  workItems: ScanReport["agentHandoff"]["workItems"];
}

interface CategoryScoresProps {
  categories: ScanReport["categories"];
}

interface EvidenceListProps {
  evidence: Evidence[];
}

interface FindingsReportProps {
  findings: ScanReport["findings"];
}

interface WarningsAlertProps {
  warnings: ScanReport["warnings"];
}

const CATEGORY_TITLES = {
  accessibility: "Accessibility",
  forms: "Forms and Data Entry",
  foundation: "Foundation",
  interaction: "Interaction",
  "production-polish": "Production Polish",
  states: "States",
} as const satisfies Record<Finding["category"], string>;

const DISPOSITION_TITLES = {
  decide: "Product decision",
  fix: "Fix",
  verify: "Manual verification",
} as const satisfies Record<WorkItem["disposition"], string>;

const STATUS_TITLES = {
  advisory: "Advisory",
  fail: "Failed",
  "not-applicable": "Not applicable",
  pass: "Passed",
} as const satisfies Record<Finding["status"], string>;

const getPriorityVariant = (priority: WorkItem["priority"]): BadgeVariant => {
  if (priority === "P0") {
    return "destructive";
  }

  if (priority === "P1") {
    return "default";
  }

  return "secondary";
};

const getStatusVariant = (status: Finding["status"]): BadgeVariant => {
  if (status === "fail") {
    return "destructive";
  }

  if (status === "pass") {
    return "secondary";
  }

  return "outline";
};

const getEvidenceLocation = (evidence: Evidence): string | null => {
  if (!evidence.filePath) {
    return null;
  }

  return evidence.line
    ? `${evidence.filePath}:${evidence.line}`
    : evidence.filePath;
};

const formatScoreValue = (score: number): string =>
  Number.isInteger(score) ? String(score) : score.toFixed(1);

const getCategoryScoreLabel = (category: CategoryScore): string => {
  if (!(category.applicable && category.percentage !== null)) {
    return "Not applicable";
  }

  return `${formatScoreValue(category.score)}/${formatScoreValue(category.maxScore)} (${category.percentage}%)`;
};

function EvidenceList({ evidence }: EvidenceListProps) {
  if (evidence.length === 0) {
    return <p>No additional evidence was recorded.</p>;
  }

  return (
    <ul>
      {evidence.map((item, index) => {
        const location = getEvidenceLocation(item);
        const evidenceKey = `${location ?? "project"}-${item.message}-${index}`;

        return (
          <li key={evidenceKey}>
            {location ? (
              <>
                <code>{location}</code>{" "}
              </>
            ) : null}
            {item.message}
          </li>
        );
      })}
    </ul>
  );
}

function WorkItemBadges({ workItem }: { workItem: WorkItem }) {
  return (
    <div className="not-typeset flex flex-wrap gap-2">
      <Badge variant={getPriorityVariant(workItem.priority)}>
        {workItem.priority}
      </Badge>
      <Badge variant="secondary">
        {DISPOSITION_TITLES[workItem.disposition]}
      </Badge>
      {workItem.categories.map((category) => (
        <Badge key={category} variant="outline">
          {CATEGORY_TITLES[category]}
        </Badge>
      ))}
      <Badge variant="outline">
        {workItem.rawScoreImpact > 0
          ? `+${formatScoreValue(workItem.rawScoreImpact)} raw rule points`
          : "No score impact"}
      </Badge>
    </div>
  );
}

function WorkItemArticle({
  findings,
  workItem,
}: {
  findings: Finding[];
  workItem: WorkItem;
}) {
  const roasts = findings.flatMap(({ roast }) => (roast ? [roast] : []));

  return (
    <article>
      <WorkItemBadges workItem={workItem} />
      <h3>{workItem.title}</h3>
      <p>{workItem.summary}</p>
      <h4>Related findings</h4>
      <ul>
        {workItem.findingIds.map((findingId) => (
          <li key={getFindingKey(workItem.packageDir, findingId)}>
            <code>{findingId}</code>
          </li>
        ))}
      </ul>
      <h4>Evidence</h4>
      <EvidenceList evidence={workItem.evidence} />
      <h4>Suggested approach</h4>
      {workItem.suggestedFixes.length > 0 ? (
        <ul>
          {workItem.suggestedFixes.map((suggestedFix) => (
            <li key={suggestedFix}>{suggestedFix}</li>
          ))}
        </ul>
      ) : (
        <p>Verify the evidence before choosing whether code should change.</p>
      )}
      <h4>Acceptance criteria</h4>
      <ul>
        {workItem.acceptanceCriteria.map((criterion) => (
          <li key={criterion}>{criterion}</li>
        ))}
      </ul>
      {roasts.map((roast) => (
        <blockquote key={roast}>
          <p>{roast}</p>
        </blockquote>
      ))}
    </article>
  );
}

function AgentContext({
  context,
  suggestedSkills,
  verification,
}: Pick<
  ActionablesReportProps,
  "context" | "suggestedSkills" | "verification"
>) {
  if (
    context.length === 0 &&
    suggestedSkills.length === 0 &&
    verification.projectGates.length === 0 &&
    !verification.shadscanCommand
  ) {
    return null;
  }

  return (
    <section aria-labelledby="agent-context-heading">
      <h3 id="agent-context-heading">Agent context</h3>
      {context.length > 0 ? (
        <ul>
          {context.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {suggestedSkills.length > 0 ? (
        <>
          <h4>Suggested skills</h4>
          <div className="not-typeset mt-3 flex flex-wrap gap-2">
            {suggestedSkills.map((skill) => (
              <Badge key={skill} variant="secondary">
                {skill}
              </Badge>
            ))}
          </div>
        </>
      ) : null}
      <h4>Verification commands</h4>
      <ul>
        <li>
          <code>{verification.shadscanCommand}</code>
        </li>
        {verification.projectGates.map((command) => (
          <li key={command}>
            <code>{command}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActionablesReport({
  context,
  findings,
  suggestedSkills,
  verification,
  workItems,
}: ActionablesReportProps) {
  if (workItems.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircleIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No actionables</EmptyTitle>
            <EmptyDescription>
              No missing UI fundamentals were found in this scan.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        <div className="typeset typeset-report">
          <AgentContext
            context={context}
            suggestedSkills={suggestedSkills}
            verification={verification}
          />
        </div>
      </div>
    );
  }

  const findingsById = new Map(
    findings.map((finding) => [
      getFindingKey(finding.packageDir, finding.id),
      finding,
    ])
  );

  return (
    <div className="typeset typeset-report">
      {workItems.map((workItem, index) => (
        <Fragment key={workItem.id}>
          {index > 0 ? <Separator className="not-typeset my-8" /> : null}
          <WorkItemArticle
            findings={workItem.findingIds.flatMap((findingId) => {
              const finding = findingsById.get(
                getFindingKey(workItem.packageDir, findingId)
              );
              return finding ? [finding] : [];
            })}
            workItem={workItem}
          />
        </Fragment>
      ))}
      <Separator className="not-typeset my-8" />
      <AgentContext
        context={context}
        suggestedSkills={suggestedSkills}
        verification={verification}
      />
    </div>
  );
}

function FindingBadges({ finding }: { finding: Finding }) {
  const scoreLabel = finding.impactsScore
    ? `${formatScoreValue(finding.score)}/${formatScoreValue(finding.maxScore)} points`
    : "No score impact";

  return (
    <div className="not-typeset flex flex-wrap gap-2">
      <Badge variant={getStatusVariant(finding.status)}>
        {STATUS_TITLES[finding.status]}
      </Badge>
      <Badge variant="outline">{CATEGORY_TITLES[finding.category]}</Badge>
      <Badge variant="outline">{finding.confidence} confidence</Badge>
      <Badge variant="outline">{scoreLabel}</Badge>
    </div>
  );
}

function FindingArticle({ finding }: { finding: Finding }) {
  return (
    <article>
      <FindingBadges finding={finding} />
      <h3>{finding.title}</h3>
      <p>{finding.description}</p>
      <p>
        Rule <code>{finding.id}</code>
      </p>
      <h4>Evidence</h4>
      <EvidenceList evidence={finding.evidence} />
      {finding.remediation ? (
        <>
          <h4>Suggested fix</h4>
          <p>{finding.remediation}</p>
        </>
      ) : null}
      {finding.roast ? (
        <blockquote>
          <p>{finding.roast}</p>
        </blockquote>
      ) : null}
    </article>
  );
}

/**
 * A pooled workspace report contains the same rule once per package, so a
 * bare rule id is no longer unique — it collapses React rows and resolves a
 * work item to another package's finding.
 */
function getFindingKey(packageDir: string | null, findingId: string): string {
  return `${packageDir ?? "."}:${findingId}`;
}

function FindingsReport({ findings }: FindingsReportProps) {
  return (
    <div className="typeset typeset-report">
      {findings.map((finding, index) => (
        <Fragment key={getFindingKey(finding.packageDir, finding.id)}>
          {index > 0 ? <Separator className="not-typeset my-8" /> : null}
          <FindingArticle finding={finding} />
        </Fragment>
      ))}
    </div>
  );
}

function CategoryScores({ categories }: CategoryScoresProps) {
  return (
    <section aria-labelledby="category-scores-heading">
      <h3 className="font-heading font-medium" id="category-scores-heading">
        Category scores
      </h3>
      <div className="mt-4 flex flex-col gap-4">
        {categories.map((category) => {
          const scoreLabel = getCategoryScoreLabel(category);

          return (
            <div className="flex flex-col gap-2" key={category.id}>
              <div className="flex items-start justify-between gap-4 text-sm">
                <span>{category.title}</span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {scoreLabel}
                </span>
              </div>
              <Progress
                aria-label={`${category.title}: ${scoreLabel}`}
                aria-valuetext={scoreLabel}
                max={100}
                value={category.percentage}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WarningsAlert({ warnings }: WarningsAlertProps) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <Alert>
      <WarningCircleIcon aria-hidden="true" />
      <AlertTitle>Scan warnings</AlertTitle>
      <AlertDescription>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export { ActionablesReport, CategoryScores, FindingsReport, WarningsAlert };
