import { emitKeypressEvents } from "node:readline";
import picocolors from "picocolors";
import type { TerminalCapabilities } from "./terminal-capabilities";

const HIDE_CURSOR = "\u001b[?25l";
const SHOW_CURSOR = "\u001b[?25h";
const CLEAR_LINE = "\u001b[2K\r";
const DIGIT_PATTERN = /^[1-9]$/;

interface SelectMenuOption {
  description: string;
  label: string;
}

interface SelectKeypress {
  ctrl?: boolean;
  name?: string;
}

interface SelectInputStream extends NodeJS.EventEmitter {
  isTTY?: boolean;
  pause: () => unknown;
  resume: () => unknown;
  setRawMode?: (mode: boolean) => unknown;
}

interface SelectOutputStream {
  columns?: number;
  write: (text: string) => unknown;
}

interface SelectFromMenuOptions {
  capabilities: Pick<TerminalCapabilities, "color" | "unicode">;
  escapeIndex?: number;
  header?: string;
  initialIndex?: number;
  input: SelectInputStream;
  options: SelectMenuOption[];
  output: SelectOutputStream;
  sendInterrupt?: () => void;
}

const supportsRawSelection = (input: SelectInputStream): boolean =>
  input.isTTY === true && typeof input.setRawMode === "function";

const moveCursorUp = (lines: number): string =>
  lines > 0 ? `\u001b[${lines}A` : "";

const truncateToWidth = (line: string, columns: number | undefined): string =>
  columns !== undefined && columns > 1 && line.length > columns - 1
    ? `${line.slice(0, columns - 2)}…`
    : line;

const renderMenuLines = ({
  activeIndex,
  capabilities,
  options,
  output,
}: {
  activeIndex: number;
  capabilities: Pick<TerminalCapabilities, "color" | "unicode">;
  options: SelectMenuOption[];
  output: SelectOutputStream;
}): string[] => {
  const colors = picocolors.createColors(capabilities.color);
  const pointer = capabilities.unicode ? "❯" : ">";
  const lines = options.map((option, index) => {
    const isActive = index === activeIndex;
    const marker = isActive ? pointer : " ";
    const label = isActive ? colors.cyan(option.label) : option.label;
    const description = option.description
      ? colors.dim(` — ${option.description}`)
      : "";
    return truncateToWidth(
      `${marker} ${index + 1}. ${label}${description}`,
      output.columns
    );
  });

  const hint = capabilities.unicode
    ? "↑/↓ move · Enter select · Esc done"
    : "up/down move, Enter select, Esc done";
  lines.push(colors.dim(hint));
  return lines;
};

const resolveKeypressIntent = (
  text: string | undefined,
  key: SelectKeypress | undefined
): "down" | "escape" | "interrupt" | "select" | "up" | number | null => {
  if (key?.ctrl && key.name === "c") {
    return "interrupt";
  }
  if (key?.name === "up" || text === "k") {
    return "up";
  }
  if (key?.name === "down" || text === "j") {
    return "down";
  }
  if (key?.name === "return" || key?.name === "enter") {
    return "select";
  }
  if (key?.name === "escape" || text === "q") {
    return "escape";
  }
  if (text && DIGIT_PATTERN.test(text)) {
    return Number.parseInt(text, 10) - 1;
  }
  return null;
};

const selectFromMenu = ({
  capabilities,
  escapeIndex,
  header,
  initialIndex = 0,
  input,
  options,
  output,
  sendInterrupt = () => process.kill(process.pid, "SIGINT"),
}: SelectFromMenuOptions): Promise<number> =>
  new Promise((resolve) => {
    emitKeypressEvents(input as NodeJS.ReadableStream & SelectInputStream);
    const previousRawMode =
      "isRaw" in input ? Boolean((input as { isRaw?: boolean }).isRaw) : false;
    input.setRawMode?.(true);
    input.resume();
    output.write(HIDE_CURSOR);

    if (header) {
      output.write(`\n${header}\n`);
    }

    let activeIndex = Math.min(Math.max(initialIndex, 0), options.length - 1);
    let renderedLineCount = 0;

    const render = (): void => {
      const lines = renderMenuLines({
        activeIndex,
        capabilities,
        options,
        output,
      });
      output.write(moveCursorUp(renderedLineCount));
      for (const line of lines) {
        output.write(`${CLEAR_LINE}${line}\n`);
      }
      renderedLineCount = lines.length;
    };

    const cleanup = (): void => {
      input.removeListener("keypress", onKeypress);
      input.setRawMode?.(previousRawMode);
      input.pause();
      output.write(SHOW_CURSOR);
    };

    const finish = (index: number): void => {
      cleanup();
      resolve(index);
    };

    const onKeypress = (
      text: string | undefined,
      key: SelectKeypress | undefined
    ): void => {
      const intent = resolveKeypressIntent(text, key);

      if (intent === "interrupt") {
        cleanup();
        sendInterrupt();
        return;
      }
      if (intent === "up") {
        activeIndex = (activeIndex - 1 + options.length) % options.length;
        render();
        return;
      }
      if (intent === "down") {
        activeIndex = (activeIndex + 1) % options.length;
        render();
        return;
      }
      if (intent === "select") {
        finish(activeIndex);
        return;
      }
      if (intent === "escape") {
        finish(escapeIndex ?? options.length - 1);
        return;
      }
      if (typeof intent === "number" && intent < options.length) {
        finish(intent);
      }
    };

    input.on("keypress", onKeypress);
    render();
  });

export type {
  SelectFromMenuOptions,
  SelectInputStream,
  SelectMenuOption,
  SelectOutputStream,
};
export { selectFromMenu, supportsRawSelection };
