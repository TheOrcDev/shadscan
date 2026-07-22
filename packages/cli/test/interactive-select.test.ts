import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  selectFromMenu,
  supportsRawSelection,
} from "../src/interactive-select";

const OPTIONS = [
  { description: "copy it", label: "Copy the agent handoff" },
  { description: "print it", label: "Print the agent handoff" },
  { description: "leave unchanged", label: "Done" },
];

const createFakeInput = () => {
  const input = new Readable({
    read() {
      // Bytes are pushed manually by each test.
    },
  }) as Readable & {
    isTTY: boolean;
    setRawMode: ReturnType<typeof vi.fn>;
  };
  input.isTTY = true;
  input.setRawMode = vi.fn();
  return input;
};

const createFakeOutput = () => {
  const chunks: string[] = [];
  return {
    chunks,
    columns: 100,
    text: () => chunks.join(""),
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
  };
};

const runSelect = (
  input: ReturnType<typeof createFakeInput>,
  output: ReturnType<typeof createFakeOutput>,
  overrides: Partial<Parameters<typeof selectFromMenu>[0]> = {}
) =>
  selectFromMenu({
    capabilities: { color: false, unicode: true },
    header: "What next?",
    input,
    options: OPTIONS,
    output,
    ...overrides,
  });

describe("interactive select", () => {
  it("detects raw-mode support", () => {
    expect(supportsRawSelection(createFakeInput())).toBe(true);
    const noTty = createFakeInput();
    noTty.isTTY = false;
    expect(supportsRawSelection(noTty)).toBe(false);
    expect(
      supportsRawSelection({
        isTTY: true,
        pause: () => null,
        resume: () => null,
      } as never)
    ).toBe(false);
  });

  it("moves with arrow bytes and selects with Enter", async () => {
    const input = createFakeInput();
    const output = createFakeOutput();
    const selection = runSelect(input, output);

    input.push("\u001b[B");
    input.push("\r");

    await expect(selection).resolves.toBe(1);
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(output.text()).toContain("\u001b[?25l");
    expect(output.text()).toContain("\u001b[?25h");
    expect(output.text()).toContain("What next?");
    expect(output.text()).toContain("❯");
  });

  it("wraps upward from the first option", async () => {
    const input = createFakeInput();
    const output = createFakeOutput();
    const selection = runSelect(input, output);

    input.push("\u001b[A");
    input.push("\r");

    await expect(selection).resolves.toBe(OPTIONS.length - 1);
  });

  it("selects Done through escape and q", async () => {
    for (const trigger of [
      () => ({ key: { name: "escape" }, text: undefined }),
      () => ({ key: undefined, text: "q" }),
    ]) {
      const input = createFakeInput();
      const output = createFakeOutput();
      const selection = runSelect(input, output);
      const { key, text } = trigger();

      input.emit("keypress", text, key);

      await expect(selection).resolves.toBe(OPTIONS.length - 1);
      expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    }
  });

  it("honors an explicit escape index", async () => {
    const input = createFakeInput();
    const output = createFakeOutput();
    const selection = runSelect(input, output, { escapeIndex: 0 });

    input.emit("keypress", "q", undefined);

    await expect(selection).resolves.toBe(0);
  });

  it("selects instantly through number shortcuts", async () => {
    const input = createFakeInput();
    const output = createFakeOutput();
    const selection = runSelect(input, output);

    input.push("2");

    await expect(selection).resolves.toBe(1);
  });

  it("ignores out-of-range numbers and unknown keys", async () => {
    const input = createFakeInput();
    const output = createFakeOutput();
    const selection = runSelect(input, output);

    input.push("9");
    input.push("x");
    input.push("\r");

    await expect(selection).resolves.toBe(0);
  });

  it("restores the terminal and forwards Ctrl+C", async () => {
    const input = createFakeInput();
    const output = createFakeOutput();
    const sendInterrupt = vi.fn();
    const pendingSelection = runSelect(input, output, { sendInterrupt });

    input.emit("keypress", "", { ctrl: true, name: "c" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(sendInterrupt).toHaveBeenCalledTimes(1);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(output.text()).toContain("\u001b[?25h");
    const outcome = await Promise.race([
      pendingSelection.then(() => "settled"),
      Promise.resolve("pending"),
    ]);
    expect(outcome).toBe("pending");
  });

  it("renders an ascii pointer and hint without unicode", async () => {
    const input = createFakeInput();
    const output = createFakeOutput();
    const selection = runSelect(input, output, {
      capabilities: { color: false, unicode: false },
    });

    input.push("\r");

    await expect(selection).resolves.toBe(0);
    expect(output.text()).toContain("> 1.");
    expect(output.text()).toContain("up/down move");
    expect(output.text()).not.toContain("❯");
  });
});
