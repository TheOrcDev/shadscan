"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";

interface RuleCategory {
  description: string;
  id: string;
  title: string;
}

interface RuleCatalogEntry {
  adapters: string[];
  category: string;
  confidence: string;
  description: string;
  id: string;
  maxScore: number;
  severity: string;
  title: string;
}

interface RulesCatalogProps {
  categories: RuleCategory[];
  rules: RuleCatalogEntry[];
}

const ADAPTER_LABELS: Record<string, string> = {
  core: "All supported apps",
  "next-app-router": "Next.js App Router",
  "next-hybrid-router": "Next.js hybrid",
  "next-pages-router": "Next.js Pages Router",
  "vite-react": "React with Vite",
};

const getScoreLabel = (rule: RuleCatalogEntry): string => {
  if (rule.maxScore === 0 || rule.confidence === "low") {
    return "Advisory";
  }

  return `${rule.maxScore} raw ${rule.maxScore === 1 ? "point" : "points"}`;
};

const getSearchText = (rule: RuleCatalogEntry): string =>
  [
    rule.id,
    rule.title,
    rule.description,
    rule.category,
    rule.confidence,
    rule.severity,
    ...rule.adapters,
    ...rule.adapters.map((adapter) => ADAPTER_LABELS[adapter] ?? adapter),
  ]
    .join(" ")
    .toLowerCase();

function RulesCatalog({ categories, rules }: RulesCatalogProps) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRules = useMemo(() => {
    if (!normalizedQuery) {
      return rules;
    }

    return rules.filter((rule) =>
      getSearchText(rule).includes(normalizedQuery)
    );
  }, [normalizedQuery, rules]);

  const visibleRulesByCategory = useMemo(
    () =>
      new Map(
        categories.map((category) => [
          category.id,
          visibleRules.filter((rule) => rule.category === category.id),
        ])
      ),
    [categories, visibleRules]
  );

  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-3 border-y py-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full max-w-md">
          <label className="font-semibold text-sm" htmlFor="rule-search">
            Search rules
          </label>
          <InputGroup className="mt-2">
            <InputGroupInput
              autoComplete="off"
              id="rule-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search rules..."
              type="search"
              value={query}
            />
            <InputGroupAddon>
              <MagnifyingGlassIcon aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
        </div>
        <p
          aria-live="polite"
          className="shrink-0 font-mono text-muted-foreground text-xs"
          role="status"
        >
          Showing {visibleRules.length} of {rules.length} rules
        </p>
      </div>

      {visibleRules.length === 0 ? (
        <Empty className="mt-8 min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MagnifyingGlassIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No matching rules</EmptyTitle>
            <EmptyDescription>
              Try a rule name, ID, category, or framework.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-14 pt-12">
          {categories.map((category) => {
            const categoryRules = visibleRulesByCategory.get(category.id) ?? [];

            if (categoryRules.length === 0) {
              return null;
            }

            const categoryHeadingId = `category-${category.id}-heading`;

            return (
              <section
                aria-labelledby={categoryHeadingId}
                className="scroll-mt-6"
                id={`category-${category.id}`}
                key={category.id}
              >
                <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                  <div>
                    <h2
                      className="font-heading font-medium text-2xl"
                      id={categoryHeadingId}
                    >
                      {category.title}
                    </h2>
                    <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
                      {category.description}
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {categoryRules.length}{" "}
                    {categoryRules.length === 1 ? "rule" : "rules"}
                  </Badge>
                </header>

                <div className="mt-6 border-y">
                  {categoryRules.map((rule, index) => (
                    <div key={rule.id}>
                      {index > 0 ? <Separator /> : null}
                      <article
                        aria-labelledby={`${rule.id}-title`}
                        className="grid scroll-mt-6 gap-5 py-6 md:grid-cols-[minmax(0,1fr)_13rem] md:gap-8"
                        data-rule-id={rule.id}
                        id={rule.id}
                      >
                        <div className="min-w-0">
                          <a
                            className="group inline-flex max-w-full items-baseline gap-2 underline-offset-4 hover:underline"
                            href={`#${rule.id}`}
                          >
                            <h3
                              className="font-heading font-medium text-lg"
                              id={`${rule.id}-title`}
                            >
                              {rule.title}
                            </h3>
                            <span
                              aria-hidden="true"
                              className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                            >
                              #
                            </span>
                          </a>
                          <code className="mt-1 block break-all font-mono text-muted-foreground text-xs">
                            {rule.id}
                          </code>
                          <p className="mt-3 text-muted-foreground text-sm leading-6">
                            {rule.description}
                          </p>
                        </div>

                        <dl className="flex flex-col gap-3 text-sm">
                          <div className="flex items-center justify-between gap-3 md:flex-col md:items-start md:gap-1">
                            <dt className="text-muted-foreground text-xs">
                              Score behavior
                            </dt>
                            <dd>
                              <Badge
                                variant={
                                  rule.maxScore === 0 ||
                                  rule.confidence === "low"
                                    ? "secondary"
                                    : "default"
                                }
                              >
                                {getScoreLabel(rule)}
                              </Badge>
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-3 md:flex-col md:items-start md:gap-1">
                            <dt className="text-muted-foreground text-xs">
                              Signal
                            </dt>
                            <dd className="flex flex-wrap justify-end gap-2 md:justify-start">
                              <Badge variant="secondary">
                                {rule.confidence} confidence
                              </Badge>
                              <Badge variant="secondary">{rule.severity}</Badge>
                            </dd>
                          </div>
                          <div className="flex items-start justify-between gap-3 md:flex-col md:gap-1">
                            <dt className="shrink-0 text-muted-foreground text-xs">
                              Runs in
                            </dt>
                            <dd className="text-right text-muted-foreground text-xs leading-5 md:text-left">
                              {rule.adapters
                                .map(
                                  (adapter) =>
                                    ADAPTER_LABELS[adapter] ?? adapter
                                )
                                .join(", ")}
                            </dd>
                          </div>
                        </dl>
                      </article>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { RulesCatalog };
