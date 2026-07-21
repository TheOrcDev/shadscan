import { createInterface } from "node:readline/promises";
import type { AgentCliCandidate, AgentId } from "./agent-cli";

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
  | { kind: "done" }
  | { kind: "pre-commit" };

interface PostScanMenuOption {
  action: PostScanAction;
  description: string;
  label: string;
}

interface CreatePostScanMenuOptions {
  agents: AgentCliCandidate[];
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
  includePreCommit,
}: CreatePostScanMenuOptions): PostScanMenuOption[] => {
  const options = agents.map(
    (agent): PostScanMenuOption => ({
      action: { agentId: agent.agentId, kind: "agent" },
      description: "Validate and launch the selected provider from PATH.",
      label: `Fix with ${agent.label}`,
    })
  );

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

const renderPostScanMenu = (options: PostScanMenuOption[]): string => {
  const includesAgent = options.some(
    (option) => option.action.kind === "agent"
  );
  const lines = [
    "",
    includesAgent
      ? "What next? External agents may read and edit files, run commands, and send prompt data to their provider."
      : "What next?",
  ];

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
  includePreCommit,
  input = process.stdin,
  write = (message) => process.stderr.write(message),
}: PromptPostScanActionOptions): Promise<PostScanAction> => {
  const options = createPostScanMenu({ agents, includePreCommit });
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
