import { RulesCatalog } from "@/components/rules-catalog";
import catalog from "@/lib/generated/rule-catalog.json";
import { createPageMetadata } from "@/lib/site-metadata";

export const dynamic = "force-static";

export const metadata = createPageMetadata({
  description:
    "Explore every deterministic Shadscan rule across accessibility, interaction, UI states, forms, foundation, and production polish.",
  imageAlt: "The complete Shadscan rule catalog",
  path: "/rules",
  title: "Shadscan rule catalog",
});

const scoredRuleCount = catalog.rules.filter(
  (rule) => rule.maxScore > 0 && rule.confidence !== "low"
).length;
const advisoryRuleCount = catalog.rules.length - scoredRuleCount;

export default function RulesPage() {
  return (
    <main className="flex-1 bg-background text-foreground">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="max-w-3xl">
          <p className="font-mono text-muted-foreground text-sm">
            Ruleset {catalog.rulesetVersion}
          </p>
          <h1 className="mt-2 text-balance font-heading font-medium text-3xl sm:text-4xl">
            Every rule Shadscan checks
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-muted-foreground leading-7">
            Shadscan reads your source and configuration without changing your
            project. These deterministic checks cover the UI fundamentals that
            are easy to miss and expensive to discover late.
          </p>
        </header>

        <dl className="mt-10 grid grid-cols-2 border-y sm:grid-cols-4">
          <div className="flex flex-col gap-1 py-5 pr-4 sm:py-6">
            <dt className="text-muted-foreground text-sm">Rules</dt>
            <dd className="font-heading font-medium text-2xl">
              {catalog.rules.length}
            </dd>
          </div>
          <div className="flex flex-col gap-1 border-l px-4 py-5 sm:py-6">
            <dt className="text-muted-foreground text-sm">Categories</dt>
            <dd className="font-heading font-medium text-2xl">
              {catalog.categories.length}
            </dd>
          </div>
          <div className="flex flex-col gap-1 border-t py-5 pr-4 sm:border-t-0 sm:border-l sm:px-4 sm:py-6">
            <dt className="text-muted-foreground text-sm">Scored checks</dt>
            <dd className="font-heading font-medium text-2xl">
              {scoredRuleCount}
            </dd>
          </div>
          <div className="flex flex-col gap-1 border-t border-l px-4 py-5 sm:border-t-0 sm:py-6">
            <dt className="text-muted-foreground text-sm">Advisories</dt>
            <dd className="font-heading font-medium text-2xl">
              {advisoryRuleCount}
            </dd>
          </div>
        </dl>

        <div className="mt-10 grid min-w-0 gap-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-16">
          <aside
            aria-label="Rule categories"
            className="lg:sticky lg:top-6 lg:self-start"
          >
            <p className="font-semibold text-sm">Jump to a category</p>
            <nav
              aria-label="Rule category shortcuts"
              className="mt-3 flex flex-wrap"
            >
              <ul className="flex flex-wrap gap-x-4 gap-y-2 lg:flex-col lg:gap-1">
                {catalog.categories.map((category) => (
                  <li key={category.id}>
                    <a
                      className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
                      href={`#category-${category.id}`}
                    >
                      {category.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <p className="mt-5 hidden text-muted-foreground text-xs leading-5 lg:block">
              Raw points are normalized inside each weighted category to produce
              the 100-point score. Advisories never lower it.
            </p>
          </aside>

          <RulesCatalog categories={catalog.categories} rules={catalog.rules} />
        </div>
      </div>
    </main>
  );
}
