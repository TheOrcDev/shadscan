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

const SOURCE_COMMAND = "node packages/cli/dist/cli.js /path/to/app";
const REPOSITORY_URL = "https://github.com/TheOrcDev/headless-shadcn";

function CommandMenu() {
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
    setOpen(false);
    window.open(REPOSITORY_URL, "_blank", "noopener,noreferrer");
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
        onClick={() => setOpen(true)}
        type="button"
        variant="outline"
      >
        <MagnifyingGlass data-icon="inline-start" weight="bold" />
        Commands
        <kbd className="ml-1 hidden border bg-muted px-1 font-mono text-[10px] sm:inline">
          Ctrl K
        </kbd>
      </Button>
      <CommandDialog
        description="Navigate Shadscan and copy common commands."
        onOpenChange={setOpen}
        open={open}
        title="Shadscan commands"
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
              <CommandItem onSelect={openRepository}>
                <GithubLogo weight="bold" />
                Open GitHub repository
                <ArrowSquareOut className="ml-auto" weight="bold" />
              </CommandItem>
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
