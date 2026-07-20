"use client";

import { Label as LabelPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "flex select-none items-center gap-2 font-semibold text-xs uppercase tracking-wide peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-data-[slot=checkbox]:font-normal peer-data-[slot=radio-group-item]:font-normal peer-data-[slot=switch]:font-normal peer-data-[slot=checkbox]:text-sm peer-data-[slot=radio-group-item]:text-sm peer-data-[slot=switch]:text-sm peer-data-[slot=checkbox]:normal-case peer-data-[slot=radio-group-item]:normal-case peer-data-[slot=switch]:normal-case peer-data-[slot=checkbox]:tracking-normal peer-data-[slot=radio-group-item]:tracking-normal peer-data-[slot=switch]:tracking-normal",
        className
      )}
      data-slot="label"
      {...props}
    />
  );
}

export { Label };
