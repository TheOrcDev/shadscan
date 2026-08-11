"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DEFAULT_COLLAPSED_LINES = 10;

interface CollapsibleCodeProps {
  className?: string;
  code: string;
  collapsedLines?: number;
  language: string;
  preClassName?: string;
}

export function CollapsibleCode({
  className,
  code,
  collapsedLines = DEFAULT_COLLAPSED_LINES,
  language,
  preClassName,
}: CollapsibleCodeProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const baseId = useId();
  const accessibleCodeId = `${baseId}-accessible`;
  const lines = code.split("\n");
  const preview = lines.slice(0, collapsedLines).join("\n");
  const remainingLines = lines.slice(collapsedLines);
  const remainder =
    remainingLines.length > 0 ? `\n${remainingLines.join("\n")}` : "";
  const isCollapsible = remainder.length > 0;

  return (
    <div data-slot="collapsible-code">
      <pre
        aria-hidden={isCollapsible ? true : undefined}
        className={preClassName}
      >
        <code
          className={cn("block", className)}
          data-language={language}
          data-slot="code-block"
          style={
            isCollapsible && !isExpanded
              ? { maxHeight: `${collapsedLines}lh`, overflow: "hidden" }
              : undefined
          }
        >
          {code}
        </code>
      </pre>

      {isCollapsible ? (
        <div className="flex border-t px-1 py-1">
          <code className="sr-only whitespace-pre-wrap" id={accessibleCodeId}>
            {preview}
            <span hidden={!isExpanded}>{remainder}</span>
          </code>
          <Button
            aria-controls={accessibleCodeId}
            aria-expanded={isExpanded}
            onClick={() => {
              setIsExpanded((expanded) => !expanded);
            }}
            size="xs"
            type="button"
            variant="link"
          >
            {isExpanded ? "Read less" : "Read more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
