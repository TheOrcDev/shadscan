import { describe, expect, it } from "vitest";
import { resolveTerminalCapabilities } from "../src/terminal-capabilities";

describe("resolveTerminalCapabilities", () => {
  it("enables Unicode and color for an interactive terminal", () => {
    expect(
      resolveTerminalCapabilities({
        columns: 100,
        env: { TERM: "xterm-256color" },
        isTTY: true,
      })
    ).toEqual({ color: true, columns: 100, unicode: true });
  });

  it.each([
    {
      env: { TERM: "xterm-256color" },
      isTTY: false,
      label: "non-TTY output",
    },
    { env: { CI: "1" }, isTTY: true, label: "CI output" },
    { env: { TERM: "dumb" }, isTTY: true, label: "a dumb terminal" },
  ])("uses the plain fallback for $label", ({ env, isTTY }) => {
    expect(resolveTerminalCapabilities({ columns: 80, env, isTTY })).toEqual({
      color: false,
      columns: 80,
      unicode: false,
    });
  });

  it("honors NO_COLOR without disabling the Unicode layout", () => {
    expect(
      resolveTerminalCapabilities({
        columns: 80,
        env: { NO_COLOR: "", TERM: "xterm-256color" },
        isTTY: true,
      })
    ).toEqual({ color: false, columns: 80, unicode: true });
  });

  it("lets FORCE_COLOR color an ASCII fallback", () => {
    expect(
      resolveTerminalCapabilities({
        env: { CI: "true", FORCE_COLOR: "1" },
        isTTY: true,
      })
    ).toEqual({ color: true, columns: null, unicode: false });
  });

  it("lets NO_COLOR win when both color preferences are present", () => {
    expect(
      resolveTerminalCapabilities({
        env: { FORCE_COLOR: "1", NO_COLOR: "1" },
        isTTY: false,
      })
    ).toEqual({ color: false, columns: null, unicode: false });
  });

  it("treats explicit false-like CI and FORCE_COLOR values as disabled", () => {
    expect(
      resolveTerminalCapabilities({
        columns: 90,
        env: { CI: "false", FORCE_COLOR: "0" },
        isTTY: true,
      })
    ).toEqual({ color: true, columns: 90, unicode: true });
  });

  it.each([
    { columns: 79.8, expected: 79 },
    { columns: 0, expected: null },
    { columns: Number.NaN, expected: null },
    { columns: undefined, expected: null },
  ])("normalizes terminal columns from $columns", ({ columns, expected }) => {
    expect(
      resolveTerminalCapabilities({ columns, env: {}, isTTY: false }).columns
    ).toBe(expected);
  });
});
