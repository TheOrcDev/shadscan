import { afterEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import { createProgram } from "../src/cli";
import { normalizeCliFailure } from "../src/cli-error";
import { ProjectDiscoveryError } from "../src/discovery";
import { resolveOutputFormat, wantsJsonOutput } from "../src/output-format";

const captureOutput = async (args: string[]): Promise<string> => {
  let output = "";
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });

  try {
    await createProgram().parseAsync(["node", "shadscan", ...args]);
    return output;
  } finally {
    write.mockRestore();
  }
};

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("CLI contract", () => {
  it("reads its version from the package manifest", () => {
    expect(createProgram().version()).toBe(packageJson.version);
  });

  it("supports prompt and JSON output aliases", async () => {
    expect(await captureOutput(["--prompt"])).toBe(
      await captureOutput(["--format", "prompt"])
    );

    const jsonAlias = JSON.parse(await captureOutput(["--json"])) as {
      durationMs: number;
      findings: unknown[];
      schemaVersion: number;
    };
    const jsonFormat = JSON.parse(
      await captureOutput(["--format", "json"])
    ) as typeof jsonAlias;

    expect({ ...jsonAlias, durationMs: 0 }).toEqual({
      ...jsonFormat,
      durationMs: 0,
    });
  });

  it("keeps prompt output neutral and fail-under semantics intact", async () => {
    const prompt = await captureOutput(["--prompt", "--roast"]);

    expect(prompt).toContain("<shadscan-data");
    expect(prompt).not.toContain('"roast"');

    await captureOutput(["--prompt", "--fail-under", "100"]);
    expect(process.exitCode).toBe(1);
  });

  it("rejects conflicting output selectors", async () => {
    const program = createProgram().exitOverride();
    program.configureOutput({
      writeErr: () => undefined,
    });

    await expect(
      program.parseAsync(["node", "shadscan", "--json", "--prompt"])
    ).rejects.toMatchObject({ code: "commander.conflictingOption" });
  });

  it("recognizes JSON formatting for runtime failures", () => {
    expect(wantsJsonOutput(["node", "shadscan", "--json"])).toBe(true);
    expect(wantsJsonOutput(["node", "shadscan", "--format", "json"])).toBe(
      true
    );
    expect(wantsJsonOutput(["node", "shadscan", "--format=json"])).toBe(true);
    expect(wantsJsonOutput(["node", "shadscan", "--prompt"])).toBe(false);
    expect(resolveOutputFormat({ prompt: true })).toBe("prompt");
  });

  it("turns expected discovery failures into stable messages", () => {
    expect(
      normalizeCliFailure(new ProjectDiscoveryError("No package.json found."))
    ).toEqual({
      code: "PROJECT_NOT_FOUND",
      message: "No package.json found.",
    });
    expect(
      normalizeCliFailure(new SyntaxError("private parser detail"))
    ).toEqual({
      code: "INVALID_PROJECT_METADATA",
      message: "Project metadata could not be parsed.",
    });
    expect(normalizeCliFailure(new Error("private runtime detail"))).toEqual({
      code: "AUDIT_FAILED",
      message: "Shadscan could not complete the audit.",
    });
  });
});
