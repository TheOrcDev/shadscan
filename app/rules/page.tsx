import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
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

export default function RulesPage() {
  const defaultOpenCategories = catalog.categories.map(
    (category) => category.id
  );

  return (
    <main className="flex-1 bg-background text-foreground">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header>
          <p className="font-mono text-muted-foreground text-sm">Catalog</p>
          <h1 className="mt-2 font-heading font-medium text-3xl">Rules</h1>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Bundled ruleset{" "}
            <code className="font-mono text-sm">{catalog.rulesetVersion}</code>{" "}
            contains {catalog.rules.length} deterministic static-analysis rules
            across {catalog.categories.length} categories. Expand a category to
            browse its checks.
          </p>
        </header>

        <Accordion
          className="mt-12"
          defaultValue={defaultOpenCategories}
          type="multiple"
        >
          {catalog.categories.map((category) => {
            const categoryRules = catalog.rules.filter(
              (rule) => rule.category === category.id
            );
            const categoryHeadingId = `category-${category.id}-heading`;

            return (
              <AccordionItem
                className="scroll-mt-10"
                id={`category-${category.id}`}
                key={category.id}
                value={category.id}
              >
                <AccordionTrigger
                  className="font-heading text-base sm:text-lg"
                  id={categoryHeadingId}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="truncate">{category.title}</span>
                    <Badge variant="outline">{categoryRules.length}</Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">
                    {categoryRules.map((rule) => (
                      <li className="min-w-0" key={rule.id}>
                        <article
                          aria-labelledby={`${rule.id}-title`}
                          className="flex h-full scroll-mt-6 flex-col border border-border p-4"
                          data-rule-id={rule.id}
                          id={rule.id}
                        >
                          <h3
                            className="font-heading font-medium text-base"
                            id={`${rule.id}-title`}
                          >
                            <a
                              className="underline-offset-4 hover:underline"
                              href={`#${rule.id}`}
                            >
                              {rule.title}
                            </a>
                          </h3>
                          <p className="mt-2 flex-1 text-muted-foreground text-sm leading-6">
                            {rule.description}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{rule.confidence}</Badge>
                            {rule.maxScore === 0 ||
                            rule.confidence === "low" ? (
                              <Badge variant="secondary">Advisory</Badge>
                            ) : (
                              <Badge variant="secondary">
                                {rule.maxScore}{" "}
                                {rule.maxScore === 1 ? "point" : "points"}
                              </Badge>
                            )}
                          </div>
                        </article>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </div>
    </main>
  );
}
