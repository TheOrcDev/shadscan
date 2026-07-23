"use client";

import {
  ArrowSquareOut,
  BookOpen,
  ClipboardText,
  ClockCounterClockwise,
  GithubLogo,
  ListChecks,
  MagnifyingGlass,
  Sparkle,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
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
} from "@/components/ui/command";
import { AGENT_AUDIT_PROMPT } from "@/lib/agent-prompt";
import { DOCS_SECTIONS } from "@/lib/docs-sections";

const SOURCE_COMMAND = "npx @shadscan/cli /path/to/app";
interface CommandMenuProps {
  repositoryUrl?: string;
}

function CommandMenu({ repositoryUrl }: CommandMenuProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

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

  const copyAgentPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_AUDIT_PROMPT);
      setOpen(false);
      toast.success("Agent prompt copied");
    } catch {
      toast.error("Could not copy the agent prompt");
    }
  };

  const openDocsSection = (hash: `#${string}`) => {
    setOpen(false);
    router.push(`/docs${hash}`, { scroll: false });

    // The app router does not reliably scroll to a hash target on client
    // navigation, and scrolling is a no-op while the closing dialog's body
    // scroll lock is still active, so retry until the scroll takes effect.
    const scrollTolerancePx = 80;
    let remainingAttempts = 40;
    const scrollToSection = () => {
      const section = document.getElementById(hash.slice(1));
      if (section) {
        section.scrollIntoView({ block: "start" });
        if (
          Math.abs(section.getBoundingClientRect().top) <= scrollTolerancePx
        ) {
          return;
        }
      }
      remainingAttempts -= 1;
      if (remainingAttempts > 0) {
        setTimeout(scrollToSection, 50);
      }
    };
    setTimeout(scrollToSection, 50);
  };

  return (
    <>
      <Button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Search documentation"
        className="relative size-8 justify-start bg-muted/50 font-normal text-muted-foreground normal-case tracking-normal shadow-none transition-colors sm:h-8 sm:w-40 sm:px-3 sm:pr-12 lg:w-64"
        onClick={() => setOpen(true)}
        type="button"
        variant="outline"
      >
        <MagnifyingGlass
          className="sm:hidden"
          data-icon="inline-start"
          weight="bold"
        />
        <span className="hidden sm:inline-flex lg:hidden">Search...</span>
        <span className="hidden lg:inline-flex">Search documentation...</span>
        <kbd className="pointer-events-none absolute top-1.5 right-1.5 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-medium font-mono text-[10px] text-muted-foreground sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
      <CommandDialog
        description="Navigate shadscan and copy common commands."
        onOpenChange={setOpen}
        open={open}
        title="shadscan commands"
      >
        <Command>
          <CommandInput placeholder="Type a command or search..." />
          <CommandList>
            <CommandEmpty>No matching command.</CommandEmpty>
            {repositoryUrl ? (
              <CommandGroup heading="Navigate">
                <CommandItem onSelect={openRepository}>
                  <GithubLogo weight="bold" />
                  Open GitHub repository
                  <ArrowSquareOut className="ml-auto" weight="bold" />
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Docs">
              {DOCS_SECTIONS.map((section) => (
                <CommandItem
                  key={section.href}
                  onSelect={() => openDocsSection(section.href)}
                >
                  <BookOpen weight="bold" />
                  {section.label}
                </CommandItem>
              ))}
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  router.push("/rules");
                }}
              >
                <ListChecks weight="bold" />
                Rules
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  router.push("/changelog");
                }}
              >
                <ClockCounterClockwise weight="bold" />
                Changelog
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="CLI">
              <CommandItem onSelect={copySourceCommand}>
                <ClipboardText weight="bold" />
                Copy source command
              </CommandItem>
              <CommandItem onSelect={copyAgentPrompt}>
                <Sparkle weight="bold" />
                Copy agent prompt
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

export { CommandMenu };
