import type * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "field-sizing-content flex min-h-16 w-full resize-none rounded-none border border-transparent border-b-input bg-transparent px-0 py-3 text-base outline-none transition-[color,border-color] placeholder:text-muted-foreground focus-visible:border-b-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-b-destructive md:text-sm dark:aria-invalid:border-b-destructive/50",
        className
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
