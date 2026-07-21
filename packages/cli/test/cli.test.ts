import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";
import {
  canEstablishPreCommitFloor,
  createProgram,
  resolveProjectPath,
  runCli,
  scoreFailsThreshold,
} from "../src/cli";
import { normalizeCliFailure } from "../src/cli-error";
import { ProjectDiscoveryError } from "../src/discovery";
import { resolveOutputFormat, wantsJsonOutput } from "../src/output-format";
import { createRuleFixture } from "./rule-fixture";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const PLAIN_SCORE_PATTERN =
  /Your shadscan score: \[[#-]{16}\] \d+\/100 \(Grade [A-F]\)/;

const setInteractiveTerminal = (): (() => void) => {
  const streams = [process.stdin, process.stdout, process.stderr];
  const descriptors = streams.map((stream) =>
    Object.getOwnPropertyDescriptor(stream, "isTTY")
  );

  for (const stream of streams) {
    Object.defineProperty(stream, "isTTY", {
      configurable: true,
      value: true,
    });
  }

  return () => {
    for (const [index, stream] of streams.entries()) {
      const descriptor = descriptors[index];
      if (descriptor) {
        Object.defineProperty(stream, "isTTY", descriptor);
      } else {
        Reflect.deleteProperty(stream, "isTTY");
      }
    }
  };
};

const restoreEnvironment = (
  environment: Record<string, string | undefined>
): void => {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = value;
    }
  }
};

const captureOutput = async (
  args: string[],
  cwd = path.resolve(testDirectory, "../../..")
): Promise<string> => {
  const previousCwd = process.cwd();
  let output = "";
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });

  try {
    process.chdir(cwd);
    await createProgram().parseAsync(["node", "shadscan", ...args]);
    return output;
  } finally {
    process.chdir(previousCwd);
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

  it("documents interactive apply and setup entry points", () => {
    const program = createProgram();

    expect(program.helpInformation()).toContain("--apply");
    expect(program.helpInformation()).toContain("--agent <agent>");
    expect(program.helpInformation()).toContain("--no-interactive");
    expect(program.commands.map((command) => command.name())).toContain(
      "setup"
    );
  });

  it("supports prompt and JSON output aliases", async () => {
    const fixture = await createRuleFixture();

    try {
      expect(await captureOutput(["--prompt"], fixture.rootDir)).toBe(
        await captureOutput(["--format", "prompt"], fixture.rootDir)
      );

      const jsonAlias = JSON.parse(
        await captureOutput(["--json"], fixture.rootDir)
      ) as {
        durationMs: number;
        findings: unknown[];
        schemaVersion: number;
      };
      const jsonFormat = JSON.parse(
        await captureOutput(["--format", "json"], fixture.rootDir)
      ) as typeof jsonAlias;

      expect({ ...jsonAlias, durationMs: 0 }).toEqual({
        ...jsonFormat,
        durationMs: 0,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("renders a deterministic score bar when stdout is not a TTY", async () => {
    const output = await captureOutput(["--no-interactive", "--no-roast"]);

    expect(output).toMatch(PLAIN_SCORE_PATTERN);
    expect(output).not.toContain("\u001B");
  });

  it("scans an explicit project path", async () => {
    const fixture = await createRuleFixture();

    try {
      const report = JSON.parse(
        await captureOutput([fixture.rootDir, "--json"])
      ) as { packageName: string | null };

      expect(report.packageName).toBe("expanded-rule-fixture");
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps prompt output neutral and fail-under semantics intact", async () => {
    const prompt = await captureOutput(["--prompt", "--roast"]);

    expect(prompt).toContain("<shadscan-data");
    expect(prompt).not.toContain('"roast"');

    const fixture = await createRuleFixture();
    try {
      await fixture.write(
        "src/App.tsx",
        "export const App = () => <main>Fixture</main>;\n"
      );
      await captureOutput(["--prompt", "--fail-under", "100"], fixture.rootDir);
      expect(process.exitCode).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails score gates when a scan is unassessed", () => {
    expect(scoreFailsThreshold(null, 0)).toBe(true);
    expect(scoreFailsThreshold(null, 100)).toBe(true);
    expect(scoreFailsThreshold(90, 90)).toBe(false);
    expect(scoreFailsThreshold(89, 90)).toBe(true);
  });

  it("never derives a full-scan pre-commit floor from scoped or partial output", () => {
    expect(
      canEstablishPreCommitFloor({
        score: 92,
        sourceCoverage: "complete",
      })
    ).toBe(true);
    expect(
      canEstablishPreCommitFloor({
        category: "accessibility",
        score: 100,
        sourceCoverage: "complete",
      })
    ).toBe(false);
    expect(
      canEstablishPreCommitFloor({
        score: 92,
        sourceCoverage: "partial",
      })
    ).toBe(false);
    expect(
      canEstablishPreCommitFloor({
        score: null,
        sourceCoverage: "complete",
      })
    ).toBe(false);
  });

  it("fails score gates when source coverage is partial", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write("App.tsx", "x".repeat(2 * 1024 * 1024 + 1));
      const report = JSON.parse(
        await captureOutput(["--json", "--fail-under", "0"], fixture.rootDir)
      ) as { coverage: { source: string } };

      expect(report.coverage.source).toBe("partial");
      expect(process.exitCode).toBe(1);
    } finally {
      await fixture.cleanup();
    }
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

  it("requires explicit human apply semantics", async () => {
    await expect(captureOutput(["--agent", "codex"])).rejects.toThrow(
      "--agent requires --apply."
    );
    await expect(
      captureOutput(["--apply", "--format", "json"])
    ).rejects.toThrow("--apply requires human output.");
  });

  it.runIf(process.platform !== "win32")(
    "launches an explicitly selected agent and preserves failure statuses",
    async () => {
      const fixture = await createRuleFixture();
      const agentDirectory = await mkdtemp(
        path.join(tmpdir(), "shadscan-cli-agent-")
      );
      const executablePath = path.join(agentDirectory, "codex");
      const markerPath = path.join(agentDirectory, "launch.json");
      const previousEnvironment = {
        CI: process.env.CI,
        PATH: process.env.PATH,
        SHADSCAN_INTERACTIVE: process.env.SHADSCAN_INTERACTIVE,
        SHADSCAN_TEST_AGENT_EXIT: process.env.SHADSCAN_TEST_AGENT_EXIT,
        SHADSCAN_TEST_AGENT_MARKER: process.env.SHADSCAN_TEST_AGENT_MARKER,
      };
      const restoreTerminal = setInteractiveTerminal();
      const writeError = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      try {
        await fixture.write(
          "src/App.tsx",
          "export const App = () => <button />;\n"
        );
        await writeFile(
          executablePath,
          `#!${process.execPath}\nif (process.argv[2] === "--version") {\n  process.stdout.write("codex-cli 1.0.0\\n");\n  process.exit(0);\n}\nrequire("node:fs").writeFileSync(process.env.SHADSCAN_TEST_AGENT_MARKER, JSON.stringify(process.argv.slice(2)));\nprocess.exit(Number(process.env.SHADSCAN_TEST_AGENT_EXIT ?? "0"));\n`,
          { mode: 0o755 }
        );
        await chmod(executablePath, 0o755);
        process.env.CI = "";
        process.env.PATH = agentDirectory;
        process.env.SHADSCAN_INTERACTIVE = "1";
        process.env.SHADSCAN_TEST_AGENT_EXIT = "0";
        process.env.SHADSCAN_TEST_AGENT_MARKER = markerPath;

        const output = await captureOutput(
          [fixture.rootDir, "--apply", "--agent", "codex", "--no-roast"],
          fixture.rootDir
        );
        const launchArguments = JSON.parse(
          await readFile(markerPath, "utf8")
        ) as string[];

        expect(output).toContain("Your shadscan score:");
        expect(launchArguments).toHaveLength(1);
        expect(launchArguments[0]).toContain(
          "Read the complete Shadscan remediation task from the local file"
        );
        expect(process.exitCode).toBeUndefined();

        process.env.SHADSCAN_TEST_AGENT_EXIT = "7";
        await captureOutput(
          [fixture.rootDir, "--apply", "--agent", "codex", "--no-roast"],
          fixture.rootDir
        );
        expect(process.exitCode).toBe(1);
        expect(writeError).toHaveBeenCalledWith(
          expect.stringContaining("did not complete successfully (exit 7)")
        );

        process.exitCode = undefined;
        process.env.SHADSCAN_TEST_AGENT_EXIT = "0";
        await captureOutput(
          [
            fixture.rootDir,
            "--apply",
            "--agent",
            "codex",
            "--fail-under",
            "100",
            "--no-roast",
          ],
          fixture.rootDir
        );
        expect(process.exitCode).toBe(1);
      } finally {
        restoreTerminal();
        restoreEnvironment(previousEnvironment);
        writeError.mockRestore();
        await Promise.all([
          fixture.cleanup(),
          rm(agentDirectory, { force: true, recursive: true }),
        ]);
      }
    }
  );

  it("previews pre-commit setup without changing a non-Git fixture", async () => {
    const fixture = await createRuleFixture();

    try {
      const output = await captureOutput(
        ["setup", fixture.rootDir, "--pre-commit", "--dry-run"],
        fixture.rootDir
      );

      expect(output).toContain("Current Shadscan score:");
      expect(output).toContain("Shadscan pre-commit plan");
      expect(output).toContain("Mode: manual");
    } finally {
      await fixture.cleanup();
    }
  });

  it("routes JSON-selected parser failures through the JSON error contract", async () => {
    const writeErr = vi.spyOn(process.stderr, "write");

    let failure: unknown;
    try {
      await runCli(["node", "shadscan", "--json", "--prompt"]);
    } catch (error) {
      failure = error;
    }

    expect(writeErr).not.toHaveBeenCalled();
    expect(normalizeCliFailure(failure)).toEqual({
      code: "INVALID_ARGUMENTS",
      message: "option '--json' cannot be used with option '--prompt'",
    });
  });

  it("rejects nonexistent and non-directory explicit paths", async () => {
    const fixture = await createRuleFixture();

    try {
      await expect(
        resolveProjectPath("missing-project", fixture.rootDir)
      ).rejects.toMatchObject({
        code: "PROJECT_NOT_FOUND",
        message: "The project path does not exist or is not a directory.",
      });
      await expect(
        resolveProjectPath("package.json", fixture.rootDir)
      ).rejects.toMatchObject({
        code: "PROJECT_NOT_FOUND",
        message: "The project path does not exist or is not a directory.",
      });
    } finally {
      await fixture.cleanup();
    }
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
      normalizeCliFailure(
        new CommanderError(
          1,
          "commander.conflictingOption",
          "error: conflicting output options"
        )
      )
    ).toEqual({
      code: "INVALID_ARGUMENTS",
      message: "conflicting output options",
    });
    expect(
      normalizeCliFailure(
        new ProjectDiscoveryError(
          "The nearest package does not declare React.",
          "UNSUPPORTED_PROJECT"
        )
      )
    ).toEqual({
      code: "UNSUPPORTED_PROJECT",
      message: "The nearest package does not declare React.",
    });
    expect(
      normalizeCliFailure(new SyntaxError("private parser detail"))
    ).toEqual({
      code: "INVALID_PROJECT_METADATA",
      message: "Project metadata could not be parsed.",
    });
    expect(normalizeCliFailure(new Error("private runtime detail"))).toEqual({
      code: "AUDIT_FAILED",
      message: "shadscan could not complete the audit.",
    });
  });
});
