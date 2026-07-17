"use client";

import { CheckIcon, CopyIcon, XCircleIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type { ComponentProps } from "react";
import { IconSwap, IconSwapItem } from "@/components/icon-swap";
import { Button } from "@/components/ui/button";
import type { CopyState } from "@/hooks/use-copy-to-clipboard";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";

export interface CopyStateIconProps {
  /** Custom icon for done state. */
  doneIcon?: React.ReactNode;
  /** Custom icon for error state. */
  errorIcon?: React.ReactNode;
  /** Custom icon for idle state. */
  idleIcon?: React.ReactNode;
  state: CopyState;
}

export function CopyStateIcon({
  state,
  idleIcon,
  doneIcon,
  errorIcon,
}: CopyStateIconProps) {
  return (
    <IconSwap>
      <IconSwapItem as={motion.span} key={state}>
        {state === "idle" && (idleIcon ?? <CopyIcon data-slot="idle-icon" />)}

        {state === "done" && (doneIcon ?? <CheckIcon data-slot="done-icon" />)}

        {state === "error" &&
          (errorIcon ?? <XCircleIcon data-slot="error-icon" />)}
      </IconSwapItem>
    </IconSwap>
  );
}

export type CopyButtonProps = ComponentProps<typeof Button> & {
  /** The text to copy, or a function that returns the text. */
  text: string | (() => string);
  /** Called with the copied text on successful copy. */
  onCopySuccess?: (text: string) => void;
  /** Called with the error if the copy operation fails. */
  onCopyError?: (error: Error) => void;
} & Omit<CopyStateIconProps, "state">;

export function CopyButton({
  className,
  size = "icon",
  children,
  text,
  idleIcon,
  doneIcon,
  errorIcon,
  onClick,
  onCopySuccess,
  onCopyError,
  ...props
}: CopyButtonProps) {
  const { state, copy } = useCopyToClipboard({
    onCopySuccess,
    onCopyError,
  });

  return (
    <Button
      aria-label="Copy"
      className={cn("will-change-transform", className)}
      onClick={(e) => {
        copy(text);
        onClick?.(e);
      }}
      size={size}
      {...props}
    >
      <CopyStateIcon
        doneIcon={doneIcon}
        errorIcon={errorIcon}
        idleIcon={idleIcon}
        state={state}
      />
      {children}
    </Button>
  );
}
