"use client";

import {
  ArrowSquareOut,
  ClipboardText,
  Gauge,
  GithubLogo,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";

const SOURCE_COMMAND = "npx @shadscan/cli@next /path/to/app";
interface CommandMenuProps {
  repositoryUrl?: string;
}

function CommandMenu({ repositoryUrl }: CommandMenuProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const opensCommandMenu =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";

      if (!opensCommandMenu) {
        return;
      }

      event.preventDefault();
      setOpen((currentOpen) => !currentOpen);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const scrollToReport = () => {
    setOpen(false);
    document.querySelector("#report")?.scrollIntoView({ behavior: "smooth" });
  };

  const openRepository = () => {
    if (!repositoryUrl) {
      return;
    }

    setOpen(false);
    window.open(repositoryUrl, "_blank", "noopener,noreferrer");
  };

  const copySourceCommand = async () => {
    try {
      await navigator.clipboard.writeText(SOURCE_COMMAND);
      setOpen(false);
      toast.success("Source command copied");
    } catch {
      toast.error("Could not copy the source command");
    }
  };

  return (
    <>
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Open command menu"
        onClick={() => setOpen(true)}
        size="icon"
        type="button"
        variant="outline"
      >
        <MagnifyingGlass data-icon="inline-start" weight="bold" />
        <span className="sr-only">Commands</span>
      </Button>
      <CommandDialog
        description="Navigate shadscan and copy common commands."
        onOpenChange={setOpen}
        open={open}
        title="shadscan commands"
      >
        <Command>
          <CommandInput placeholder="Search commands..." />
          <CommandList>
            <CommandEmpty>No matching command.</CommandEmpty>
            <CommandGroup heading="Navigate">
              <CommandItem onSelect={scrollToReport}>
                <Gauge weight="bold" />
                View audit checks
                <CommandShortcut>Enter</CommandShortcut>
              </CommandItem>
              {repositoryUrl ? (
                <CommandItem onSelect={openRepository}>
                  <GithubLogo weight="bold" />
                  Open GitHub repository
                  <ArrowSquareOut className="ml-auto" weight="bold" />
                </CommandItem>
              ) : null}
            </CommandGroup>
            <CommandGroup heading="CLI">
              <CommandItem onSelect={copySourceCommand}>
                <ClipboardText weight="bold" />
                Copy source command
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

export { CommandMenu };
