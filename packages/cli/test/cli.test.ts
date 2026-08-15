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
  runUiCheckAction,
  scoreFailsThreshold,
} from "../src/cli";
import { normalizeCliFailure } from "../src/cli-error";
import { ProjectDiscoveryError } from "../src/discovery";
import { resolveOutputFormat, wantsJsonOutput } from "../src/output-format";
import { OverflowCheckError } from "../src/overflow-check/error";
import { createRuleFixture } from "./rule-fixture";
import {
  cleanupWorkspaceFixtures,
  createWorkspaceFixture,
} from "./workspace-fixture";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const PLAIN_SCORE_PATTERN =
  /Your shadscan score: \[[#-]{16}\] \d+\/100 \(Grade [A-F]\)/;
const PROGRESS_PHASE_LABELS = [
  "Resolving project",
  "Discovering app structure",
  "Evaluating UI rules",
  "Preparing report",
] as const;
const UI_CHECK_PROGRESS_PHASE_LABELS = [
  "Resolving UI target",
  "Checking mobile and desktop layouts",
  "Preparing UI report",
] as const;

const createPassingUiCheckResult = () => ({
  browser: { name: "chromium", version: "123" },
  durationMs: 12,
  measurements: [
    {
      clientWidth: 320,
      finalPath: "/",
      forcedScrollbar: false,
      httpStatus: 200,
      page: "/",
      scrollWidth: 320,
      viewport: { height: 820, name: "mobile", width: 320 } as const,
    },
    {
      clientWidth: 1440,
      finalPath: "/",
      forcedScrollbar: false,
      httpStatus: 200,
      page: "/",
      scrollWidth: 1440,
      viewport: { height: 1000, name: "desktop", width: 1440 } as const,
    },
  ],
  origin: "http://127.0.0.1:3000",
});

const setInteractiveTerminal = (): (() => void) => {
  const streams = [process.stdin, process.stdout, process.stderr];
  const descriptors = streams.map((stream) =>
    Object.getOwnPropertyDescriptor(stream, "isTTY")
  );
  const previousTerm = process.env.TERM;

  process.env.TERM = "xterm-256color";

  for (const stream of streams) {
    Object.defineProperty(stream, "isTTY", {
      configurable: true,
      value: true,
    });
  }

  return () => {
    if (previousTerm === undefined) {
      Reflect.deleteProperty(process.env, "TERM");
    } else {
      process.env.TERM = previousTerm;
    }

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

const captureStreams = async (
  args: string[],
  cwd = path.resolve(testDirectory, "../../..")
): Promise<{ stderr: string; stdout: string }> => {
  const previousCwd = process.cwd();
  let stderr = "";
  let stdout = "";
  const writeOutput = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
  const writeError = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });

  try {
    process.chdir(cwd);
    await createProgram().parseAsync(["node", "shadscan", ...args]);
    return { stderr, stdout };
  } finally {
    process.chdir(previousCwd);
    writeOutput.mockRestore();
    writeError.mockRestore();
  }
};

const captureUiCheckStreams = async ({
  args = [],
  ci,
  runBrowserCheck = async () => createPassingUiCheckResult(),
  stderrIsTTY = true,
  stdoutIsTTY = true,
  term = "xterm-256color",
  uiFlag = "--check-ui",
}: {
  args?: string[];
  ci?: string;
  runBrowserCheck?: () => Promise<
    ReturnType<typeof createPassingUiCheckResult>
  >;
  stderrIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  term?: string;
  uiFlag?: "--check-overflow" | "--check-ui";
}): Promise<{ failure: unknown; stderr: string; stdout: string }> => {
  const previousCi = process.env.CI;
  const restoreTerminal = setInteractiveTerminal();
  let failure: unknown;
  let stderr = "";
  let stdout = "";
  const writeError = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
  const writeOutput = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

  process.env.TERM = term;
  if (ci === undefined) {
    Reflect.deleteProperty(process.env, "CI");
  } else {
    process.env.CI = ci;
  }
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: stderrIsTTY,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: stdoutIsTTY,
  });

  try {
    await createProgram({ runBrowserCheck }).parseAsync([
      "node",
      "shadscan",
      uiFlag,
      "http://127.0.0.1:3000",
      ...args,
    ]);
  } catch (error) {
    failure = error;
  } finally {
    restoreEnvironment({ CI: previousCi });
    restoreTerminal();
    writeError.mockRestore();
    writeOutput.mockRestore();
  }

  return { failure, stderr, stdout };
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
    const help = program.helpInformation();

    expect(help).toContain("--apply");
    expect(help).toContain("--agent <agent>");
    expect(help).toContain("--check-ui <url>");
    expect(help).not.toContain("--check-overflow");
    expect(help).toContain("Add a same-origin route to --check-ui");
    expect(help).toContain("--browser-executable <path>");
    expect(help).toContain("--check-ui.");
    expect(help).toContain("--ignore <glob>");
    expect(help).toContain("--no-interactive");
    expect(help).toContain("Disable terminal progress and follow-up prompts.");
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

  it("applies --ignore to JSON coverage and source discovery", async () => {
    const fixture = await createRuleFixture();

    try {
      await fixture.write(
        "src/api/hooks/use-session.ts",
        "export function useAdminDisableSession() { return useMutation(); }\n"
      );
      const report = JSON.parse(
        await captureOutput(
          ["--json", "--ignore", "src/api/**"],
          fixture.rootDir
        )
      ) as { coverage: { ignorePatterns: string[] } };

      expect(report.coverage.ignorePatterns).toEqual(["src/api/**"]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("renders focused UI-check JSON and exits on a completed finding", async () => {
    let stdout = "";
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        stdout += String(chunk);
        return true;
      });
    const runBrowserCheck = vi.fn(async () => ({
      browser: { name: "chromium", version: "123" },
      durationMs: 12,
      measurements: [
        {
          clientWidth: 320,
          culprits: [
            {
              depth: 2,
              descriptor: '[data-slot="wide"]',
              left: 0,
              order: 1,
              overflowPx: 1,
              right: 321,
            },
          ],
          finalPath: "/",
          forcedScrollbar: false,
          httpStatus: 200,
          page: "/",
          scrollWidth: 321,
          viewport: { height: 820, name: "mobile", width: 320 } as const,
        },
        {
          clientWidth: 1440,
          finalPath: "/",
          forcedScrollbar: false,
          httpStatus: 200,
          page: "/",
          scrollWidth: 1440,
          viewport: {
            height: 1000,
            name: "desktop",
            width: 1440,
          } as const,
        },
      ],
      origin: "http://www.example.test",
    }));

    try {
      await runUiCheckAction(
        {
          interactive: false,
          outputFormat: "json",
          target: "http://127.0.0.1:3000",
        },
        { runBrowserCheck }
      );
    } finally {
      write.mockRestore();
    }

    expect(runBrowserCheck).toHaveBeenCalledOnce();
    expect(JSON.parse(stdout)).toMatchObject({
      kind: "overflow-check",
      schemaVersion: 1,
      status: "fail",
      summary: { failed: 1, maximumOverflowPx: 1, measurements: 2 },
      target: { origin: "http://www.example.test" },
    });
    expect(process.exitCode).toBe(1);
  });

  it("shows UI-check progress before the browser runner finishes", async () => {
    const previousCi = process.env.CI;
    const restoreTerminal = setInteractiveTerminal();
    let resolveBrowserCheck:
      | ((value: ReturnType<typeof createPassingUiCheckResult>) => void)
      | undefined;
    const runBrowserCheck = vi.fn(
      () =>
        new Promise<ReturnType<typeof createPassingUiCheckResult>>(
          (resolve) => {
            resolveBrowserCheck = resolve;
          }
        )
    );
    let stderr = "";
    let stdout = "";
    const writeError = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
        stderr += String(chunk);
        return true;
      });
    const writeOutput = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        stdout += String(chunk);
        return true;
      });

    Reflect.deleteProperty(process.env, "CI");

    try {
      const command = createProgram({ runBrowserCheck }).parseAsync([
        "node",
        "shadscan",
        "--check-ui",
        "http://127.0.0.1:3000",
      ]);

      await vi.waitFor(() => {
        expect(stderr).toContain(UI_CHECK_PROGRESS_PHASE_LABELS[1]);
      });
      expect(stdout).toBe("");

      resolveBrowserCheck?.(createPassingUiCheckResult());
      await command;
    } finally {
      restoreEnvironment({ CI: previousCi });
      restoreTerminal();
      writeError.mockRestore();
      writeOutput.mockRestore();
    }

    for (const label of UI_CHECK_PROGRESS_PHASE_LABELS) {
      expect(stderr).toContain(label);
      expect(stdout).not.toContain(label);
    }
    expect(stdout).toContain("PASS");
  });

  it("completes every UI-check progress phase before reporting overflow", async () => {
    const runBrowserCheck = vi.fn(() => {
      const result = createPassingUiCheckResult();
      return Promise.resolve({
        ...result,
        measurements: result.measurements.map((measurement, index) =>
          index === 0
            ? { ...measurement, scrollWidth: measurement.clientWidth + 1 }
            : measurement
        ),
      });
    });

    const output = await captureUiCheckStreams({ runBrowserCheck });

    expect(output.failure).toBeUndefined();
    for (const label of UI_CHECK_PROGRESS_PHASE_LABELS) {
      expect(output.stderr).toContain(label);
      expect(output.stdout).not.toContain(label);
    }
    expect(output.stderr.match(/✓/gu)).toHaveLength(3);
    expect(output.stderr).not.toContain("✗");
    expect(output.stdout).toContain("CRITICAL FAIL");
    expect(process.exitCode).toBe(1);
  });

  it("marks an operational UI-check failure and propagates its error", async () => {
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    const failure = new OverflowCheckError(
      "OVERFLOW_TARGET_UNAVAILABLE",
      "The target page is unavailable."
    );
    const output = await captureUiCheckStreams({
      runBrowserCheck: () => Promise.reject(failure),
    });

    expect(output.failure).toBe(failure);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain(UI_CHECK_PROGRESS_PHASE_LABELS[0]);
    expect(output.stderr).toContain(UI_CHECK_PROGRESS_PHASE_LABELS[1]);
    expect(output.stderr).not.toContain(UI_CHECK_PROGRESS_PHASE_LABELS[2]);
    expect(output.stderr.match(/✓/gu)).toHaveLength(1);
    expect(output.stderr.match(/✗/gu)).toHaveLength(1);
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
  });

  it.each([
    { args: ["--json"], label: "JSON output" },
    { args: ["--format", "json"], label: "explicit JSON output" },
    { args: ["--format=json"], label: "inline JSON output" },
    { args: ["--no-interactive"], label: "non-interactive output" },
    { args: [], ci: "1", label: "CI output" },
    { args: [], label: "non-TTY stderr", stderrIsTTY: false },
    { args: [], label: "dumb terminal", term: "dumb" },
  ])("suppresses UI-check progress for $label", async ({
    args,
    ci,
    stderrIsTTY,
    term,
  }) => {
    const output = await captureUiCheckStreams({
      args,
      ci,
      stderrIsTTY,
      term,
    });

    expect(output.failure).toBeUndefined();
    expect(output.stderr).toBe("");
    expect(output.stdout).not.toBe("");
    for (const label of UI_CHECK_PROGRESS_PHASE_LABELS) {
      expect(output.stderr).not.toContain(label);
    }
  });

  it("keeps UI-check progress on stderr when stdout is redirected", async () => {
    const output = await captureUiCheckStreams({ stdoutIsTTY: false });

    expect(output.failure).toBeUndefined();
    for (const label of UI_CHECK_PROGRESS_PHASE_LABELS) {
      expect(output.stderr).toContain(label);
      expect(output.stdout).not.toContain(label);
    }
    expect(output.stdout).toContain("PASS");
  });

  it("shows UI-check progress for explicit human output", async () => {
    const output = await captureUiCheckStreams({
      args: ["--format", "human"],
    });

    expect(output.failure).toBeUndefined();
    for (const label of UI_CHECK_PROGRESS_PHASE_LABELS) {
      expect(output.stderr).toContain(label);
    }
  });

  it("keeps UI-check progress identical through the hidden legacy alias", async () => {
    const primary = await captureUiCheckStreams({ uiFlag: "--check-ui" });
    const legacy = await captureUiCheckStreams({ uiFlag: "--check-overflow" });

    expect(primary.failure).toBeUndefined();
    expect(legacy).toEqual(primary);
  });

  it("uses --check-ui as the primary rendered UI command", async () => {
    await expect(
      captureOutput([
        "--check-ui",
        "http://127.0.0.1:3000",
        "--route",
        "/dashboard",
        "--browser-executable",
        "/tmp/chromium",
        "--category",
        "forms",
      ])
    ).rejects.toThrow("--check-ui cannot be used with --category.");
  });

  it.each([
    "--check-ui",
    "--check-overflow",
  ])("forwards routes and browser selection through %s", async (uiFlag) => {
    const runBrowserCheck = vi.fn(async () => ({
      browser: { name: "chromium", version: "123" },
      durationMs: 12,
      measurements: ["/", "/dashboard"].flatMap((page) => [
        {
          clientWidth: 320,
          finalPath: page,
          forcedScrollbar: false,
          httpStatus: 200,
          page,
          scrollWidth: 320,
          viewport: { height: 820, name: "mobile", width: 320 } as const,
        },
        {
          clientWidth: 1440,
          finalPath: page,
          forcedScrollbar: false,
          httpStatus: 200,
          page,
          scrollWidth: 1440,
          viewport: {
            height: 1000,
            name: "desktop",
            width: 1440,
          } as const,
        },
      ]),
      origin: "http://127.0.0.1:3000",
    }));
    const program = createProgram({ runBrowserCheck });
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      await program.parseAsync([
        "node",
        "shadscan",
        uiFlag,
        "http://127.0.0.1:3000",
        "--route",
        "/dashboard",
        "--browser-executable",
        "/tmp/chromium",
        "--json",
      ]);
    } finally {
      write.mockRestore();
    }

    expect(runBrowserCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        browserExecutable: "/tmp/chromium",
        origin: "http://127.0.0.1:3000",
        pages: [
          {
            displayPath: "/",
            requestedUrl: "http://127.0.0.1:3000/",
          },
          {
            displayPath: "/dashboard",
            requestedUrl: "http://127.0.0.1:3000/dashboard",
          },
        ],
        signal: expect.any(AbortSignal),
      })
    );
  });

  it.each([
    ["--check-ui", "--check-overflow"],
    ["--check-overflow", "--check-ui"],
  ])("rejects %s together with %s", async (firstFlag, secondFlag) => {
    const program = createProgram().exitOverride();
    program.configureOutput({ writeErr: () => undefined });

    await expect(
      program.parseAsync([
        "node",
        "shadscan",
        firstFlag,
        "http://127.0.0.1:3000",
        secondFlag,
        "http://127.0.0.1:3000",
      ])
    ).rejects.toMatchObject({ code: "commander.conflictingOption" });
  });

  it("keeps stderr clean when JSON mode rejects both UI flags", async () => {
    const writeError = vi.spyOn(process.stderr, "write");

    let failure: unknown;
    try {
      await runCli([
        "node",
        "shadscan",
        "--check-ui",
        "http://127.0.0.1:3000",
        "--check-overflow",
        "http://127.0.0.1:3000",
        "--json",
      ]);
    } catch (error) {
      failure = error;
    }

    expect(writeError).not.toHaveBeenCalled();
    expect(normalizeCliFailure(failure)).toMatchObject({
      code: "INVALID_ARGUMENTS",
      message: expect.stringContaining(
        "option '--check-ui <url>' cannot be used with option '--check-overflow <url>'"
      ),
    });
  });

  it("rejects rendered UI-only options during static scans", async () => {
    await expect(captureOutput(["--route", "/dashboard"])).rejects.toThrow(
      "--route requires --check-ui."
    );
    await expect(
      captureOutput(["--browser-executable", "/tmp/chromium"])
    ).rejects.toThrow("--browser-executable requires --check-ui.");
  });

  it("keeps the legacy alias compatible while rejecting static scan controls", async () => {
    const conflicts = [
      { arguments: ["--category", "forms"], option: "--category" },
      { arguments: ["--fail-under", "90"], option: "--fail-under" },
      { arguments: ["--apply"], option: "--apply" },
      { arguments: ["--agent", "codex"], option: "--agent" },
      { arguments: ["--format", "prompt"], option: "--prompt" },
      { arguments: ["--list-projects"], option: "--list-projects" },
      { arguments: ["--project", "apps/web"], option: "--project" },
      { arguments: ["--ignore", "src/api/**"], option: "--ignore" },
      { arguments: ["--roast"], option: "--roast" },
    ];

    for (const conflict of conflicts) {
      await expect(
        captureOutput([
          "--check-overflow",
          "http://127.0.0.1:3000",
          "--route",
          "/dashboard",
          "--browser-executable",
          "/tmp/chromium",
          ...conflict.arguments,
        ])
      ).rejects.toThrow(`--check-ui cannot be used with ${conflict.option}.`);
    }
  });

  it("does not let rendered UI flags leak into subcommands", async () => {
    await expect(
      captureOutput([
        "--check-overflow",
        "http://127.0.0.1:3000",
        "setup",
        "--pre-commit",
        "--dry-run",
      ])
    ).rejects.toThrow(
      "--check-ui and its related options cannot be used with subcommands."
    );
  });

  it("rejects a project path in rendered UI mode", async () => {
    await expect(
      captureOutput([
        "some-project",
        "--check-overflow",
        "http://127.0.0.1:3000",
      ])
    ).rejects.toThrow("--check-ui does not accept a project path.");
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

  it("shows the same progress phases for interactive scans and setup", async () => {
    const fixture = await createRuleFixture();
    const restoreTerminal = setInteractiveTerminal();
    const previousEnvironment = {
      CI: process.env.CI,
      SHADSCAN_INTERACTIVE: process.env.SHADSCAN_INTERACTIVE,
    };
    Reflect.deleteProperty(process.env, "CI");
    Reflect.deleteProperty(process.env, "SHADSCAN_INTERACTIVE");

    try {
      const scan = await captureStreams(
        ["--category", "forms", "--apply", "--no-roast"],
        fixture.rootDir
      );
      const setup = await captureStreams(
        ["setup", fixture.rootDir, "--pre-commit", "--dry-run"],
        fixture.rootDir
      );

      for (const output of [scan, setup]) {
        for (const label of PROGRESS_PHASE_LABELS) {
          expect(output.stderr).toContain(label);
          expect(output.stdout).not.toContain(label);
        }
      }
      expect(scan.stdout).toContain("Your shadscan score:");
      expect(setup.stdout).toContain("Current Shadscan score:");
    } finally {
      restoreTerminal();
      restoreEnvironment(previousEnvironment);
      await fixture.cleanup();
    }
  });

  it("shows progress phases for an interactive workspace scan", async () => {
    const rootDir = await createWorkspaceFixture({
      packages: [
        { path: "apps/web", preset: "next" },
        { path: "apps/admin", preset: "vite" },
      ],
    });
    const restoreTerminal = setInteractiveTerminal();
    const previousEnvironment = {
      CI: process.env.CI,
      SHADSCAN_INTERACTIVE: process.env.SHADSCAN_INTERACTIVE,
    };
    Reflect.deleteProperty(process.env, "CI");
    Reflect.deleteProperty(process.env, "SHADSCAN_INTERACTIVE");
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });

    try {
      const output = await captureStreams(
        ["--category", "forms", "--no-roast"],
        rootDir
      );

      for (const label of PROGRESS_PHASE_LABELS) {
        expect(output.stderr).toContain(label);
        expect(output.stdout).not.toContain(label);
      }
      expect(output.stdout).toContain("Workspace:");
      expect(output.stdout).toContain("Your shadscan score:");
      expect(output.stdout).not.toContain("\u001B");
    } finally {
      restoreTerminal();
      restoreEnvironment(previousEnvironment);
      await cleanupWorkspaceFixtures();
    }
  });

  it.each([
    {
      args: ["--json"],
      label: "JSON output",
    },
    {
      args: ["--prompt"],
      label: "prompt output",
    },
    {
      args: ["--category", "forms", "--no-interactive", "--no-roast"],
      label: "explicitly non-interactive output",
    },
  ])("suppresses progress for $label", async ({ args }) => {
    const fixture = await createRuleFixture();
    const restoreTerminal = setInteractiveTerminal();

    try {
      const output = await captureStreams(args, fixture.rootDir);

      for (const label of PROGRESS_PHASE_LABELS) {
        expect(output.stderr).not.toContain(label);
      }
    } finally {
      restoreTerminal();
      await fixture.cleanup();
    }
  });

  it("suppresses progress in CI even when streams are TTYs", async () => {
    const fixture = await createRuleFixture();
    const restoreTerminal = setInteractiveTerminal();
    const previousEnvironment = { CI: process.env.CI };
    process.env.CI = "1";

    try {
      const output = await captureStreams(
        ["--category", "forms", "--no-roast"],
        fixture.rootDir
      );

      for (const label of PROGRESS_PHASE_LABELS) {
        expect(output.stderr).not.toContain(label);
      }
    } finally {
      restoreTerminal();
      restoreEnvironment(previousEnvironment);
      await fixture.cleanup();
    }
  });

  it("suppresses progress when stderr is not a TTY", async () => {
    const fixture = await createRuleFixture();
    const restoreTerminal = setInteractiveTerminal();
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: false,
    });

    try {
      const output = await captureStreams(
        ["--category", "forms", "--no-roast"],
        fixture.rootDir
      );

      for (const label of PROGRESS_PHASE_LABELS) {
        expect(output.stderr).not.toContain(label);
      }
    } finally {
      restoreTerminal();
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
    expect(
      normalizeCliFailure(
        new OverflowCheckError(
          "OVERFLOW_BROWSER_UNAVAILABLE",
          "Install Chromium."
        )
      )
    ).toEqual({
      code: "OVERFLOW_BROWSER_UNAVAILABLE",
      message: "Install Chromium.",
    });
  });
});
