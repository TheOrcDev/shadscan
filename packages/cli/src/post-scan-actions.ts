import { createInterface } from "node:readline/promises";
import type { AgentCliCandidate, AgentId } from "./agent-cli";
import {
  type SelectInputStream,
  selectFromMenu,
  supportsRawSelection,
} from "./interactive-select";
import { resolveTerminalCapabilities } from "./terminal-capabilities";

const DONE_ACTION_VALUE = "done" as const;
const PRE_COMMIT_ACTION_VALUE = "pre-commit" as const;

interface InteractiveEnvironment {
  CI?: string;
  SHADSCAN_INTERACTIVE?: string;
}

interface InteractiveTerminal {
  errorIsTTY: boolean;
  inputIsTTY: boolean;
  outputIsTTY: boolean;
}

interface ResolveInteractiveModeOptions {
  enabled: boolean;
  environment: InteractiveEnvironment;
  terminal: InteractiveTerminal;
}

type PostScanAction =
  | { agentId: AgentId; kind: "agent" }
  | { kind: "copy-handoff" }
  | { kind: "done" }
  | { kind: "pre-commit" }
  | { kind: "print-handoff" };

interface PostScanMenuOption {
  action: PostScanAction;
  description: string;
  label: string;
}

interface CreatePostScanMenuOptions {
  agents: AgentCliCandidate[];
  includeHandoff: boolean;
  includePreCommit: boolean;
}

interface PromptPostScanActionOptions extends CreatePostScanMenuOptions {
  ask?: (prompt: string) => Promise<string>;
  input?: NodeJS.ReadStream;
  write?: (message: string) => void;
}

const isEnabledEnvironmentFlag = (value: string | undefined): boolean => {
  if (value === undefined) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return (
    normalizedValue !== "" &&
    normalizedValue !== "0" &&
    normalizedValue !== "false"
  );
};

const resolveInteractiveMode = ({
  enabled,
  environment,
  terminal,
}: ResolveInteractiveModeOptions): boolean =>
  enabled &&
  !isEnabledEnvironmentFlag(environment.CI) &&
  environment.SHADSCAN_INTERACTIVE !== "0" &&
  terminal.inputIsTTY &&
  terminal.outputIsTTY &&
  terminal.errorIsTTY;

const createPostScanMenu = ({
  agents,
  includeHandoff,
  includePreCommit,
}: CreatePostScanMenuOptions): PostScanMenuOption[] => {
  const options: PostScanMenuOption[] = [];

  if (includeHandoff) {
    options.push(
      {
        action: { kind: "copy-handoff" },
        description:
          "Copy the paste-ready remediation plan to the clipboard and print it.",
        label: "Copy the agent handoff",
      },
      {
        action: { kind: "print-handoff" },
        description:
          "Print the paste-ready remediation plan without copying it.",
        label: "Print the agent handoff",
      }
    );
  }

  for (const agent of agents) {
    options.push({
      action: { agentId: agent.agentId, kind: "agent" },
      description: "Validate and launch the selected provider from PATH.",
      label: `Fix with ${agent.label}`,
    });
  }

  if (includePreCommit) {
    options.push({
      action: { kind: PRE_COMMIT_ACTION_VALUE },
      description: "Preview and confirm a score-preserving Git hook.",
      label: "Add a pre-commit score gate",
    });
  }

  options.push({
    action: { kind: DONE_ACTION_VALUE },
    description: "Leave the project unchanged.",
    label: "Done",
  });

  return options;
};

const getMenuHeader = (options: PostScanMenuOption[]): string =>
  options.some((option) => option.action.kind === "agent")
    ? "What next? External agents may read and edit files, run commands, and send prompt data to their provider."
    : "What next?";

const renderPostScanMenu = (options: PostScanMenuOption[]): string => {
  const lines = ["", getMenuHeader(options)];

  for (const [index, option] of options.entries()) {
    lines.push(`  ${index + 1}. ${option.label}`, `     ${option.description}`);
  }

  return `${lines.join("\n")}\n`;
};

const parseMenuSelection = ({
  answer,
  options,
}: {
  answer: string;
  options: PostScanMenuOption[];
}): PostScanAction | null => {
  const normalizedAnswer = answer.trim();

  if (normalizedAnswer === "") {
    return options.at(-1)?.action ?? { kind: DONE_ACTION_VALUE };
  }

  const selectedIndex = Number(normalizedAnswer) - 1;
  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= options.length
  ) {
    return null;
  }

  return options[selectedIndex]?.action ?? null;
};

const promptPostScanAction = async ({
  agents,
  ask,
  includeHandoff,
  includePreCommit,
  input = process.stdin,
  write = (message) => process.stderr.write(message),
}: PromptPostScanActionOptions): Promise<PostScanAction> => {
  const options = createPostScanMenu({
    agents,
    includeHandoff,
    includePreCommit,
  });

  if (!ask && supportsRawSelection(input as SelectInputStream)) {
    const doneIndex = options.findIndex(
      (option) => option.action.kind === "done"
    );
    const selectedIndex = await selectFromMenu({
      capabilities: resolveTerminalCapabilities({
        columns: process.stderr.columns,
        env: {
          CI: process.env.CI,
          FORCE_COLOR: process.env.FORCE_COLOR,
          NO_COLOR: process.env.NO_COLOR,
          TERM: process.env.TERM,
        },
        isTTY: process.stderr.isTTY === true,
      }),
      escapeIndex: doneIndex === -1 ? undefined : doneIndex,
      header: getMenuHeader(options),
      input: input as SelectInputStream,
      options: options.map((option) => ({
        description: option.description,
        label: option.label,
      })),
      output: process.stderr,
    });
    return options[selectedIndex]?.action ?? { kind: DONE_ACTION_VALUE };
  }

  write(renderPostScanMenu(options));

  if (ask) {
    while (true) {
      const selection = parseMenuSelection({
        answer: await ask(`Choose [${options.length}]: `),
        options,
      });
      if (selection) {
        return selection;
      }
      write("Choose one of the numbered options.\n");
    }
  }

  const readline = createInterface({
    input,
    output: process.stderr,
    terminal: true,
  });

  try {
    while (true) {
      const selection = parseMenuSelection({
        answer: await readline.question(`Choose [${options.length}]: `),
        options,
      });
      if (selection) {
        return selection;
      }
      write("Choose one of the numbered options.\n");
    }
  } finally {
    readline.close();
  }
};

export type {
  CreatePostScanMenuOptions,
  InteractiveEnvironment,
  InteractiveTerminal,
  PostScanAction,
  PostScanMenuOption,
  PromptPostScanActionOptions,
  ResolveInteractiveModeOptions,
};
export {
  createPostScanMenu,
  parseMenuSelection,
  promptPostScanAction,
  renderPostScanMenu,
  resolveInteractiveMode,
};
