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
type Actionable = ScanReport["agentHandoff"]["actionables"][number];
type CategoryScore = ScanReport["categories"][number];
type Evidence = ScanReport["findings"][number]["evidence"][number];
type Finding = ScanReport["findings"][number];
type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

interface ActionablesReportProps {
  actionables: ScanReport["agentHandoff"]["actionables"];
  context: ScanReport["agentHandoff"]["context"];
  findings: ScanReport["findings"];
  suggestedSkills: ScanReport["agentHandoff"]["suggestedSkills"];
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
} as const satisfies Record<Actionable["category"], string>;

const STATUS_TITLES = {
  advisory: "Advisory",
  fail: "Failed",
  "not-applicable": "Not applicable",
  pass: "Passed",
} as const satisfies Record<Finding["status"], string>;

const getPriorityVariant = (priority: Actionable["priority"]): BadgeVariant => {
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

function ActionableBadges({ actionable }: { actionable: Actionable }) {
  return (
    <div className="not-typeset flex flex-wrap gap-2">
      <Badge variant={getPriorityVariant(actionable.priority)}>
        {actionable.priority}
      </Badge>
      <Badge variant={getStatusVariant(actionable.status)}>
        {STATUS_TITLES[actionable.status]}
      </Badge>
      <Badge variant="outline">{actionable.confidence} confidence</Badge>
      <Badge variant="outline">{CATEGORY_TITLES[actionable.category]}</Badge>
      <Badge variant="outline">
        {actionable.scoreImpact > 0
          ? `+${formatScoreValue(actionable.scoreImpact)} score impact`
          : "No score impact"}
      </Badge>
    </div>
  );
}

function ActionableArticle({
  actionable,
  finding,
}: {
  actionable: Actionable;
  finding: Finding | undefined;
}) {
  return (
    <article>
      <ActionableBadges actionable={actionable} />
      <h3>{actionable.title}</h3>
      <p>{actionable.summary}</p>
      <p>
        Finding <code>{actionable.findingId}</code>
      </p>
      <h4>Evidence</h4>
      <EvidenceList evidence={actionable.evidence} />
      <h4>Suggested fix</h4>
      <p>
        {actionable.suggestedFix ??
          "Verify the finding against the current code before choosing a fix."}
      </p>
      <h4>Acceptance criteria</h4>
      <ul>
        {actionable.acceptanceCriteria.map((criterion) => (
          <li key={criterion}>{criterion}</li>
        ))}
      </ul>
      {finding?.roast ? (
        <blockquote>
          <p>{finding.roast}</p>
        </blockquote>
      ) : null}
    </article>
  );
}

function AgentContext({
  context,
  suggestedSkills,
}: Pick<ActionablesReportProps, "context" | "suggestedSkills">) {
  if (context.length === 0 && suggestedSkills.length === 0) {
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
    </section>
  );
}

function ActionablesReport({
  actionables,
  context,
  findings,
  suggestedSkills,
}: ActionablesReportProps) {
  if (actionables.length === 0) {
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
          <AgentContext context={context} suggestedSkills={suggestedSkills} />
        </div>
      </div>
    );
  }

  const findingsById = new Map(
    findings.map((finding) => [finding.id, finding])
  );

  return (
    <div className="typeset typeset-report">
      {actionables.map((actionable, index) => (
        <Fragment key={actionable.findingId}>
          {index > 0 ? <Separator className="not-typeset my-8" /> : null}
          <ActionableArticle
            actionable={actionable}
            finding={findingsById.get(actionable.findingId)}
          />
        </Fragment>
      ))}
      <Separator className="not-typeset my-8" />
      <AgentContext context={context} suggestedSkills={suggestedSkills} />
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

function FindingsReport({ findings }: FindingsReportProps) {
  return (
    <div className="typeset typeset-report">
      {findings.map((finding, index) => (
        <Fragment key={finding.id}>
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
