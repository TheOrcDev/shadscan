import { Separator } from "@/components/ui/separator";
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
  return (
    <main className="flex-1 bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="font-heading font-medium text-3xl">Rules</h1>

        <div className="mt-12 flex flex-col gap-14">
          {catalog.categories.map((category) => {
            const categoryRules = catalog.rules.filter(
              (rule) => rule.category === category.id
            );
            const categoryHeadingId = `category-${category.id}-heading`;

            return (
              <section
                aria-labelledby={categoryHeadingId}
                id={`category-${category.id}`}
                key={category.id}
              >
                <h2
                  className="font-heading font-medium text-2xl"
                  id={categoryHeadingId}
                >
                  {category.title}
                </h2>

                <ul className="mt-5 border-y">
                  {categoryRules.map((rule, index) => (
                    <li key={rule.id}>
                      <article
                        aria-labelledby={`${rule.id}-title`}
                        className="scroll-mt-6 py-5"
                        data-rule-id={rule.id}
                        id={rule.id}
                      >
                        <h3
                          className="font-heading font-medium text-lg"
                          id={`${rule.id}-title`}
                        >
                          <a
                            className="underline-offset-4 hover:underline"
                            href={`#${rule.id}`}
                          >
                            {rule.title}
                          </a>
                        </h3>
                        <p className="mt-2 text-muted-foreground text-sm leading-6">
                          {rule.description}
                        </p>
                      </article>
                      {index < categoryRules.length - 1 ? <Separator /> : null}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
