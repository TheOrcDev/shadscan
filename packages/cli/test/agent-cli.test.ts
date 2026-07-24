import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_IDS,
  AgentCliError,
  type AgentProcessResult,
  discoverAgentClis,
  findAgentCliCandidates,
  getExecutableCandidateNames,
  launchAgentCli,
  parseAgentId,
  type RunAgentProcess,
  runAgentProcess,
} from "../src/agent-cli";
import type { AuditFinding, AuditReport } from "../src/audit";
import { createAuditReport } from "../src/audit";
import type { ProjectDiscovery } from "../src/discovery";
import { renderAgentPrompt } from "../src/render-agent-prompt";
import { stripRoasts } from "../src/render-human";

const SUCCESSFUL_PROCESS_RESULT: AgentProcessResult = {
  exitCode: 0,
  outputTruncated: false,
  signal: null,
  stderr: "",
  stdout: "",
  timedOut: false,
};

const VERSION_OUTPUTS = {
  claude: "2.1.201 (Claude Code)",
  codex: "codex-cli 0.139.0",
  grok: "grok 0.2.106",
} as const;
const PROMPT_FILE_PATTERN = /local file ("(?:[^"\\]|\\.)*") before/;
const UNSAFE_PERMISSION_FLAG_PATTERN = /dangerously|always-approve|bypass/i;

const createFixture = async (): Promise<{
  binDirectory: string;
  cleanup: () => Promise<void>;
  projectRoot: string;
  rootDirectory: string;
  temporaryRoot: string;
}> => {
  const rootDirectory = await mkdtemp(
    path.join(tmpdir(), "shadscan-agent-test-")
  );
  const binDirectory = path.join(rootDirectory, "bin");
  const projectRoot = path.join(rootDirectory, "project");
  const temporaryRoot = path.join(rootDirectory, "private-temp");
  await Promise.all([
    mkdir(binDirectory),
    mkdir(projectRoot),
    mkdir(temporaryRoot),
  ]);

  return {
    binDirectory,
    cleanup: () => rm(rootDirectory, { force: true, recursive: true }),
    projectRoot,
    rootDirectory,
    temporaryRoot,
  };
};

const createExecutable = async (
  directoryPath: string,
  name: string,
  content = "#!/bin/sh\nexit 0\n"
): Promise<string> => {
  const executablePath = path.join(directoryPath, name);
  await writeFile(executablePath, content, { mode: 0o755 });
  await chmod(executablePath, 0o755);
  return executablePath;
};

const createProject = (projectRoot: string): ProjectDiscovery => ({
  dependencies: { react: "19.2.4" },
  framework: {
    adapter: "generic-react",
    evidence: ["react dependency found"],
  },
  packageManager: "pnpm",
  packageManagerRoot: projectRoot,
  packageName: "agent-fixture",
  paths: {
    appDir: null,
    bladeRootView: null,
    inertiaPagesDir: null,
    packageJson: path.join(projectRoot, "package.json"),
    pagesDir: null,
    routesDir: null,
    srcDir: path.join(projectRoot, "src"),
    tailwindCss: null,
    tsconfig: null,
    viteEntry: null,
  },
  rootDir: projectRoot,
  selectedProjectPath: ".",
  scripts: { check: "ultracite check" },
  shadcn: {
    aliases: {},
    confidence: "high",
    configPath: path.join(projectRoot, "components.json"),
    style: "default",
  },
  sourceCoverage: "complete",
  versions: {
    inertia: null,
    laravel: null,
    next: null,
    react: "19.2.4",
    tanstackStart: null,
    vite: null,
  },
  warnings: [],
});

const createFinding = (projectRoot: string): AuditFinding => ({
  category: "accessibility",
  confidence: "high",
  description: "Checks whether buttons have accessible names.",
  evidence: [
    {
      filePath: path.join(projectRoot, "src", "Button.tsx"),
      line: 8,
      message: "An unnamed button was found.",
    },
  ],
  id: "button-has-name",
  impactsScore: true,
  maxScore: 4,
  remediation: "Give the button an accessible name.",
  roast: "Roast copy must never enter the agent prompt.",
  score: 0,
  severity: "error",
  status: "fail",
  title: "button has an accessible name",
});

const createReport = (projectRoot: string): AuditReport =>
  createAuditReport({
    durationMs: 10,
    findings: [createFinding(projectRoot)],
    project: createProject(projectRoot),
    rulesetVersion: "2026.07.33",
  });

const getPromptFilePath = (bootstrapPrompt: string): string => {
  const match = bootstrapPrompt.match(PROMPT_FILE_PATTERN);
  expect(match?.[1]).toBeDefined();
  return JSON.parse(match?.[1] ?? "null") as string;
};

describe("agent IDs", () => {
  it("keeps the supported provider set closed and parses exact IDs", () => {
    expect(AGENT_IDS).toEqual(["claude", "codex", "grok"]);
    expect(parseAgentId("claude")).toBe("claude");
    expect(parseAgentId("codex")).toBe("codex");
    expect(parseAgentId("grok")).toBe("grok");
    expect(() => parseAgentId("aider")).toThrow(AgentCliError);
    expect(() => parseAgentId("aider")).toThrowError(
      expect.objectContaining({
        code: "UNSUPPORTED_AGENT",
        message: "Expected one of: claude, codex, grok.",
      })
    );
  });

  it("uses PATHEXT when constructing Windows candidates", () => {
    expect(
      getExecutableCandidateNames({
        command: "codex",
        environment: { PATHEXT: ".EXE;.CMD" },
        platform: "win32",
      })
    ).toEqual(["codex.EXE", "codex.CMD"]);
    expect(
      getExecutableCandidateNames({
        command: "codex.exe",
        environment: { PathExt: ".EXE;.CMD" },
        platform: "win32",
      })
    ).toEqual(["codex.exe"]);
  });
});

describe("discoverAgentClis", () => {
  it("lists external candidates without executing their version commands", async () => {
    const fixture = await createFixture();

    try {
      await Promise.all(
        AGENT_IDS.map((agentId) =>
          createExecutable(fixture.binDirectory, agentId)
        )
      );
      const candidates = await findAgentCliCandidates({
        env: { PATH: fixture.binDirectory },
        projectRoot: fixture.projectRoot,
        runtime: {
          runProcess: () => {
            throw new Error("Candidate listing must not execute a binary.");
          },
        },
      });

      expect(candidates.map(({ agentId }) => agentId)).toEqual(AGENT_IDS);
    } finally {
      await fixture.cleanup();
    }
  });

  it("resolves relative PATH entries from the requested working directory", async () => {
    const fixture = await createFixture();

    try {
      const executable = await createExecutable(fixture.binDirectory, "codex");
      const candidates = await findAgentCliCandidates({
        cwd: fixture.projectRoot,
        env: {
          PATH: path.relative(fixture.projectRoot, fixture.binDirectory),
        },
        projectRoot: fixture.projectRoot,
      });

      expect(candidates).toEqual([
        {
          agentId: "codex",
          executablePath: await realpath(executable),
          label: "Codex CLI",
        },
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns only executables that pass provider-specific version probes", async () => {
    const fixture = await createFixture();

    try {
      await Promise.all(
        AGENT_IDS.map((agentId) =>
          createExecutable(fixture.binDirectory, agentId)
        )
      );
      const requests: Parameters<RunAgentProcess>[0][] = [];
      const runProcess: RunAgentProcess = (request) => {
        requests.push(request);
        const agentId = path.basename(
          request.executablePath
        ) as keyof typeof VERSION_OUTPUTS;
        return Promise.resolve({
          ...SUCCESSFUL_PROCESS_RESULT,
          stdout: VERSION_OUTPUTS[agentId],
        });
      };
      const agents = await discoverAgentClis({
        env: { PATH: fixture.binDirectory },
        projectRoot: fixture.projectRoot,
        runtime: { runProcess },
      });

      expect(agents.map(({ agentId }) => agentId)).toEqual(AGENT_IDS);
      expect(agents.map(({ version }) => version)).toEqual([
        VERSION_OUTPUTS.claude,
        VERSION_OUTPUTS.codex,
        VERSION_OUTPUTS.grok,
      ]);
      expect(requests).toHaveLength(3);
      for (const request of requests) {
        expect(request).toMatchObject({
          args: ["--version"],
          cwd: fixture.projectRoot,
          output: "capture",
          shell: false,
        });
      }
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a project-local shim and continues to a healthy global executable", async () => {
    const fixture = await createFixture();

    try {
      const projectBin = path.join(fixture.projectRoot, "node_modules", ".bin");
      await mkdir(projectBin, { recursive: true });
      const projectExecutable = await createExecutable(projectBin, "claude");
      const globalExecutable = await createExecutable(
        fixture.binDirectory,
        "claude"
      );
      const canonicalGlobalExecutable = await realpath(globalExecutable);
      const probedPaths: string[] = [];
      const runProcess: RunAgentProcess = (request) => {
        probedPaths.push(request.executablePath);
        return Promise.resolve({
          ...SUCCESSFUL_PROCESS_RESULT,
          stdout: VERSION_OUTPUTS.claude,
        });
      };
      const agents = await discoverAgentClis({
        env: {
          PATH: [projectBin, fixture.binDirectory].join(path.delimiter),
        },
        projectRoot: fixture.projectRoot,
        runtime: { runProcess },
      });

      expect(agents).toHaveLength(1);
      expect(agents[0]?.executablePath).toBe(canonicalGlobalExecutable);
      expect(probedPaths).toEqual([canonicalGlobalExecutable]);
      expect(probedPaths).not.toContain(projectExecutable);
    } finally {
      await fixture.cleanup();
    }
  });

  it("omits executables with failing or mismatched version output", async () => {
    const fixture = await createFixture();

    try {
      await Promise.all([
        createExecutable(fixture.binDirectory, "claude"),
        createExecutable(fixture.binDirectory, "codex"),
      ]);
      const runProcess: RunAgentProcess = (request) =>
        Promise.resolve({
          ...SUCCESSFUL_PROCESS_RESULT,
          exitCode: path.basename(request.executablePath) === "claude" ? 1 : 0,
          stdout: "unrelated tool 1.0.0",
        });

      expect(
        await discoverAgentClis({
          env: { PATH: fixture.binDirectory },
          projectRoot: fixture.projectRoot,
          runtime: { runProcess },
        })
      ).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("launchAgentCli", () => {
  it.each(
    AGENT_IDS
  )("launches %s with a private neutral prompt file and current interactive arguments", async (agentId) => {
    const fixture = await createFixture();

    try {
      await createExecutable(fixture.binDirectory, agentId);
      const report = createReport(fixture.projectRoot);
      const requests: Parameters<RunAgentProcess>[0][] = [];
      const runProcess: RunAgentProcess = async (request) => {
        requests.push(request);
        if (request.output === "capture") {
          return {
            ...SUCCESSFUL_PROCESS_RESULT,
            stdout: VERSION_OUTPUTS[agentId],
          };
        }

        const bootstrapPrompt = request.args.at(-1) ?? "";
        const promptFilePath = getPromptFilePath(bootstrapPrompt);
        const [prompt, promptStats] = await Promise.all([
          readFile(promptFilePath, "utf8"),
          stat(promptFilePath),
        ]);
        expect(prompt).toBe(renderAgentPrompt(stripRoasts(report)));
        expect(prompt).not.toContain(
          "Roast copy must never enter the agent prompt."
        );
        if (process.platform !== "win32") {
          expect(promptStats.mode.toString(8).slice(-3)).toBe("600");
        }
        expect(request.cwd).toBe(fixture.projectRoot);
        expect(request.shell).toBe(false);
        expect(request.output).toBe("inherit");
        expect(request.args.join(" ")).not.toMatch(
          UNSAFE_PERMISSION_FLAG_PATTERN
        );
        expect(request.args).toEqual(
          agentId === "grok"
            ? ["--verbatim", bootstrapPrompt]
            : [bootstrapPrompt]
        );
        return SUCCESSFUL_PROCESS_RESULT;
      };

      const result = await launchAgentCli({
        agentId,
        cwd: fixture.projectRoot,
        env: { PATH: fixture.binDirectory },
        projectRoot: fixture.projectRoot,
        report,
        runtime: {
          runProcess,
          temporaryRoot: fixture.temporaryRoot,
        },
      });

      expect(result).toMatchObject({
        agentId,
        exitCode: 0,
        signal: null,
        success: true,
      });
      expect(requests).toHaveLength(2);
      expect(await readdir(fixture.temporaryRoot)).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("cleans up the prompt after a launch failure", async () => {
    const fixture = await createFixture();

    try {
      await createExecutable(fixture.binDirectory, "claude");
      const runProcess: RunAgentProcess = (request) => {
        if (request.output === "capture") {
          return Promise.resolve({
            ...SUCCESSFUL_PROCESS_RESULT,
            stdout: VERSION_OUTPUTS.claude,
          });
        }

        return Promise.reject(new Error("spawn failed"));
      };

      await expect(
        launchAgentCli({
          agentId: "claude",
          cwd: fixture.projectRoot,
          env: { PATH: fixture.binDirectory },
          projectRoot: fixture.projectRoot,
          report: createReport(fixture.projectRoot),
          runtime: {
            runProcess,
            temporaryRoot: fixture.temporaryRoot,
          },
        })
      ).rejects.toMatchObject({
        agentId: "claude",
        code: "AGENT_LAUNCH_FAILED",
        message: "Shadscan could not start Claude Code.",
      });
      expect(await readdir(fixture.temporaryRoot)).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns a typed unsuccessful result for a non-zero child exit", async () => {
    const fixture = await createFixture();

    try {
      await createExecutable(fixture.binDirectory, "codex");
      const runProcess: RunAgentProcess = (request) =>
        Promise.resolve(
          request.output === "capture"
            ? {
                ...SUCCESSFUL_PROCESS_RESULT,
                stdout: VERSION_OUTPUTS.codex,
              }
            : { ...SUCCESSFUL_PROCESS_RESULT, exitCode: 7 }
        );
      const result = await launchAgentCli({
        agentId: "codex",
        cwd: fixture.projectRoot,
        env: { PATH: fixture.binDirectory },
        projectRoot: fixture.projectRoot,
        report: createReport(fixture.projectRoot),
        runtime: {
          runProcess,
          temporaryRoot: fixture.temporaryRoot,
        },
      });

      expect(result).toMatchObject({
        exitCode: 7,
        signal: null,
        success: false,
      });
      expect(await readdir(fixture.temporaryRoot)).toEqual([]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports stable missing, project-local, and unhealthy errors", async () => {
    const fixture = await createFixture();

    try {
      await expect(
        launchAgentCli({
          agentId: "claude",
          cwd: fixture.projectRoot,
          env: { PATH: fixture.binDirectory },
          projectRoot: fixture.projectRoot,
          report: createReport(fixture.projectRoot),
        })
      ).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" });

      const projectBin = path.join(fixture.projectRoot, "bin");
      await mkdir(projectBin);
      await createExecutable(projectBin, "claude");
      await expect(
        launchAgentCli({
          agentId: "claude",
          cwd: fixture.projectRoot,
          env: { PATH: projectBin },
          projectRoot: fixture.projectRoot,
          report: createReport(fixture.projectRoot),
        })
      ).rejects.toMatchObject({ code: "AGENT_PROJECT_LOCAL" });

      await createExecutable(fixture.binDirectory, "claude");
      const unhealthyProbe: RunAgentProcess = () =>
        Promise.resolve({
          ...SUCCESSFUL_PROCESS_RESULT,
          exitCode: 1,
        });
      await expect(
        launchAgentCli({
          agentId: "claude",
          cwd: fixture.projectRoot,
          env: { PATH: fixture.binDirectory },
          projectRoot: fixture.projectRoot,
          report: createReport(fixture.projectRoot),
          runtime: { runProcess: unhealthyProbe },
        })
      ).rejects.toMatchObject({ code: "AGENT_NOT_HEALTHY" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports a stable error when a private prompt file cannot be created", async () => {
    const fixture = await createFixture();

    try {
      await createExecutable(fixture.binDirectory, "grok");
      const runProcess: RunAgentProcess = () =>
        Promise.resolve({
          ...SUCCESSFUL_PROCESS_RESULT,
          stdout: VERSION_OUTPUTS.grok,
        });
      const missingTemporaryRoot = path.join(
        fixture.rootDirectory,
        "missing",
        "temp"
      );

      await expect(
        launchAgentCli({
          agentId: "grok",
          cwd: fixture.projectRoot,
          env: { PATH: fixture.binDirectory },
          projectRoot: fixture.projectRoot,
          report: createReport(fixture.projectRoot),
          runtime: {
            runProcess,
            temporaryRoot: missingTemporaryRoot,
          },
        })
      ).rejects.toMatchObject({ code: "AGENT_PROMPT_CREATE_FAILED" });
    } finally {
      await fixture.cleanup();
    }
  });
});

describe.runIf(process.platform !== "win32")("runAgentProcess", () => {
  it("passes hostile text as one argument without shell interpretation", async () => {
    const fixture = await createFixture();

    try {
      const executablePath = await createExecutable(
        fixture.binDirectory,
        "argument-recorder",
        "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n"
      );
      const markerPath = path.join(fixture.rootDirectory, "must-not-exist");
      const hostileArgument = `$(touch ${markerPath}); "quoted" & still-one-argument`;
      const result = await runAgentProcess({
        args: [hostileArgument],
        cwd: fixture.projectRoot,
        executablePath,
        output: "capture",
        shell: false,
      });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([hostileArgument]);
      await expect(stat(markerPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("force-kills and settles a probe at its timeout", async () => {
    const fixture = await createFixture();

    try {
      const executablePath = await createExecutable(
        fixture.binDirectory,
        "stuck-probe",
        "#!/usr/bin/env node\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1000);\n"
      );
      const startedAt = performance.now();
      const result = await runAgentProcess({
        args: [],
        cwd: fixture.projectRoot,
        executablePath,
        output: "capture",
        shell: false,
        timeoutMs: 25,
      });

      expect(result.timedOut).toBe(true);
      expect(result.signal).toBe("SIGKILL");
      expect(performance.now() - startedAt).toBeLessThan(1500);
    } finally {
      await fixture.cleanup();
    }
  });
});
