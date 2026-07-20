import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

interface ShadscanMarkProps extends ComponentProps<"svg"> {
  accessibleTitle?: string;
}

function ShadscanMark({
  accessibleTitle,
  className,
  ...props
}: ShadscanMarkProps) {
  return (
    <svg
      aria-hidden={accessibleTitle ? undefined : true}
      aria-label={accessibleTitle}
      className={cn("size-6 shrink-0", className)}
      fill="none"
      role={accessibleTitle ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeWidth="6"
      viewBox="0 0 64 64"
      {...props}
    >
      <path d="M23 11H11v12" />
      <path d="M41 11h12v12" />
      <path d="M11 41v12h12" />
      <path d="M53 41v12H41" />
      <g transform="translate(3.4 3.4) scale(.864)">
        <path d="m22 41 19-19" />
        <path d="m35 43 8-8" />
      </g>
    </svg>
  );
}

export { ShadscanMark };
