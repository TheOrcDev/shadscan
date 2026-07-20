"use client";

import { type MouseEvent, useCallback } from "react";
import { cn } from "@/lib/utils";

export interface DocsSection {
  href: `#${string}`;
  label: string;
}

interface DocsOnThisPageProps {
  sections: readonly DocsSection[];
}

function DocsOnThisPage({ sections }: DocsOnThisPageProps) {
  const handleSectionClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: DocsSection["href"]) => {
      const targetId = href.slice(1);
      const target = document.getElementById(targetId);

      if (!target) {
        return;
      }

      event.preventDefault();
      // Intentional TOC navigation — always animate; ambient motion is still
      // reduced via the prefers-reduced-motion CSS rules elsewhere.
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.pushState(null, "", href);
    },
    []
  );

  return (
    <nav aria-label="On this page" className="sticky top-8">
      <p className="mb-3 font-medium text-foreground text-sm">On this page</p>
      <ul className="flex flex-col gap-1 border-l">
        {sections.map((section) => (
          <li key={section.href}>
            <a
              className={cn(
                "block border-transparent border-l px-3 py-1.5 text-muted-foreground text-sm",
                "hover:border-foreground hover:text-foreground",
                "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
              )}
              href={section.href}
              onClick={(event) => {
                handleSectionClick(event, section.href);
              }}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export { DocsOnThisPage };
