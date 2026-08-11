import { access, stat } from "node:fs/promises";
import path from "node:path";
import {
  Command,
  CommanderError,
  InvalidArgumentError,
  Option,
} from "commander";
import packageJson from "../package.json";
import {
  type AgentId,
  findAgentCliCandidates,
  launchAgentCli,
  parseAgentId,
} from "./agent-cli";
import {
  AUDIT_CATEGORIES,
  type AuditCategory,
  type AuditReport,
} from "./audit";
import { copyToClipboard } from "./clipboard";
import {
  discoverProject,
  type ProjectDiscovery,
  ProjectDiscoveryError,
} from "./discovery";
import {
  type OutputFormat,
  parseOutputFormat,
  resolveOutputFormat,
  wantsJsonOutput,
} from "./output-format";
import type {
  OverflowBrowserCheckResult,
  RunOverflowBrowserCheckOptions,
} from "./overflow-check/browser";
import { evaluateOverflowCheck } from "./overflow-check/evaluate";
import { resolveOverflowCheckTarget } from "./overflow-check/options";
import { renderOverflowCheckReport } from "./overflow-check/render-human";
import {
  promptPostScanAction,
  resolveInteractiveMode,
} from "./post-scan-actions";
import {
  applyPreCommitInstallPlan,
  createPreCommitInstallPlan,
  detectPreCommitProtection,
  formatPreCommitInstallPlan,
  PreCommitError,
  type PreCommitInstallPlan,
} from "./pre-commit";
import { renderAgentPrompt } from "./render-agent-prompt";
import {
  renderHumanReport,
  sanitizeTerminalText,
  stripRoasts,
} from "./render-human";
import { scanProject } from "./scan";
import { createScanProgress, type ScanProgress } from "./scan-progress";
import { scanWorkspace } from "./scan-workspace";
import { resolveTerminalCapabilities } from "./terminal-capabilities";
import { discoverWorkspace } from "./workspace";

const VERSION = packageJson.version;

interface CliOptions {
  agent?: AgentId;
  apply?: boolean;
  browserExecutable?: string;
  category?: AuditCategory;
  checkOverflow?: string;
  checkUi?: string;
  failUnder?: number;
  format?: OutputFormat;
  interactive: boolean;
  json?: boolean;
  listProjects?: boolean;
  project?: string;
  prompt?: boolean;
  roast?: boolean;
  route?: string[];
}

interface SetupOptions {
  dryRun?: boolean;
  preCommit: boolean;
  yes?: boolean;
}

type OverflowBrowserRunner = (
  options: RunOverflowBrowserCheckOptions
) => Promise<OverflowBrowserCheckResult>;

interface UiCheckRuntime {
  runBrowserCheck?: OverflowBrowserRunner;
}

const parseScore = (value: string): number => {
  const score = Number(value);

  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new InvalidArgumentError("Expected an integer between 0 and 100.");
  }

  return score;
};

const parseCategory = (value: string): AuditCategory => {
  const category = AUDIT_CATEGORIES.find(
    (auditCategory) => auditCategory === value
  );

  if (!category) {
    throw new InvalidArgumentError(
      `Expected one of: ${AUDIT_CATEGORIES.join(", ")}.`
    );
  }

  return category;
};

const parseAgent = (value: string): AgentId => {
  try {
    return parseAgentId(value);
  } catch {
    throw new InvalidArgumentError("Expected one of: claude, codex, grok.");
  }
};

const collectRoute = (value: string, routes: string[] = []): string[] => {
  routes.push(value);
  return routes;
};

const scoreFailsThreshold = (
  score: number | null,
  threshold: number,
  sourceCoverage: "complete" | "partial" = "complete"
): boolean =>
  sourceCoverage === "partial" || score === null || score < threshold;

const canEstablishPreCommitFloor = ({
  category,
  score,
  sourceCoverage,
}: {
  category?: AuditCategory;
  score: number | null;
  sourceCoverage: "complete" | "partial";
}): boolean =>
  category === undefined && score !== null && sourceCoverage === "complete";

const resolveProjectPath = async (
  projectPath: string,
  cwd: string = process.cwd()
): Promise<string> => {
  const resolvedPath = path.resolve(cwd, projectPath);

  try {
    const projectStats = await stat(resolvedPath);
    if (projectStats.isDirectory()) {
      return resolvedPath;
    }
  } catch {
    // The stable public error below intentionally omits the scanner's path.
  }

  throw new ProjectDiscoveryError(
    "The project path does not exist or is not a directory."
  );
};

const getInteractiveTerminal = (): {
  errorIsTTY: boolean;
  inputIsTTY: boolean;
  outputIsTTY: boolean;
} => ({
  errorIsTTY: process.stderr.isTTY === true,
  inputIsTTY: process.stdin.isTTY === true,
  outputIsTTY: process.stdout.isTTY === true,
});

const canPromptInteractively = (enabled = true): boolean =>
  resolveInteractiveMode({
    enabled,
    environment: {
      CI: process.env.CI,
      SHADSCAN_INTERACTIVE: process.env.SHADSCAN_INTERACTIVE,
    },
    terminal: getInteractiveTerminal(),
  });

const createCliScanProgress = (enabled: boolean): ScanProgress => {
  const terminal = resolveTerminalCapabilities({
    columns: process.stderr.columns,
    env: {
      CI: process.env.CI,
      FORCE_COLOR: process.env.FORCE_COLOR,
      NO_COLOR: process.env.NO_COLOR,
      TERM: process.env.TERM,
    },
    isTTY: process.stderr.isTTY === true,
  });

  return createScanProgress({
    enabled: enabled && terminal.unicode,
    output: process.stderr,
    terminal,
  });
};

const resolveAgentTrustRoot = async (startPath: string): Promise<string> => {
  let currentPath = path.resolve(startPath);

  while (true) {
    try {
      await access(path.join(currentPath, ".git"));
      return currentPath;
    } catch {
      const parentPath = path.dirname(currentPath);

      if (parentPath === currentPath) {
        return path.resolve(startPath);
      }
      currentPath = parentPath;
    }
  }
};

const askForConfirmation = async (message: string): Promise<boolean> => {
  const { createInterface } = await import("node:readline/promises");
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  try {
    const answer = (await readline.question(`${message} [y/N] `))
      .trim()
      .toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    readline.close();
  }
};

const getPreCommitFloor = (
  report: Awaited<ReturnType<typeof scanProject>>
): number => {
  if (report.score === null || report.coverage.source !== "complete") {
    throw new PreCommitError(
      "INVALID_SCORE",
      "A complete, assessed scan is required before creating a pre-commit floor."
    );
  }

  return report.score;
};

const buildPreCommitPlan = async ({
  project,
  report,
}: {
  project: ProjectDiscovery;
  report: Awaited<ReturnType<typeof scanProject>>;
}): Promise<PreCommitInstallPlan> =>
  createPreCommitInstallPlan({
    packageManager: project.packageManager,
    projectRoot: project.rootDir,
    score: getPreCommitFloor(report),
    version: VERSION,
  });

const printAppliedPreCommitResult = ({
  alreadyApplied,
  changedPaths,
}: Awaited<ReturnType<typeof applyPreCommitInstallPlan>>): void => {
  if (alreadyApplied) {
    process.stderr.write(
      "The Shadscan pre-commit gate is already installed.\n"
    );
    return;
  }

  process.stderr.write(
    `Installed the Shadscan pre-commit gate in ${changedPaths.map(sanitizeTerminalText).join(", ")}.\n`
  );
};

const offerPreCommitInstall = async (
  plan: PreCommitInstallPlan
): Promise<void> => {
  process.stderr.write(`\n${formatPreCommitInstallPlan(plan)}`);

  if (plan.mode === "not-needed") {
    return;
  }

  if (plan.mode === "manual") {
    process.stderr.write(
      "No files were changed; follow the manual steps above.\n"
    );
    return;
  }

  if (!(await askForConfirmation("Apply this pre-commit plan?"))) {
    process.stderr.write("No files were changed.\n");
    return;
  }

  printAppliedPreCommitResult(
    await applyPreCommitInstallPlan(plan, { confirmed: true })
  );
};

const runAgent = async ({
  agentId,
  project,
  report,
}: {
  agentId: AgentId;
  project: ProjectDiscovery;
  report: Awaited<ReturnType<typeof scanProject>>;
}): Promise<void> => {
  process.stderr.write(
    `\nLaunching ${agentId} with the Shadscan remediation prompt...\n`
  );
  const agentTrustRoot = await resolveAgentTrustRoot(
    project.packageManagerRoot
  );
  const result = await launchAgentCli({
    agentId,
    cwd: project.packageManagerRoot,
    projectRoot: agentTrustRoot,
    report,
  });

  if (!result.success) {
    process.stderr.write(
      `The ${agentId} process did not complete successfully${
        result.exitCode === null ? "" : ` (exit ${result.exitCode})`
      }.\n`
    );
    process.exitCode = 1;
  }
};

const runExplicitApply = async ({
  agentId,
  project,
  report,
}: {
  agentId?: AgentId;
  project: ProjectDiscovery;
  report: Awaited<ReturnType<typeof scanProject>>;
}): Promise<void> => {
  if (!canPromptInteractively()) {
    throw new InvalidArgumentError(
      "--apply requires an interactive local terminal and is disabled in CI."
    );
  }

  if (report.agentHandoff.workItems.length === 0) {
    process.stderr.write(
      "\nNo actionable findings were found, so no agent was launched.\n"
    );
    return;
  }

  let selectedAgent = agentId;
  if (!selectedAgent) {
    const agentTrustRoot = await resolveAgentTrustRoot(
      project.packageManagerRoot
    );
    const agents = await findAgentCliCandidates({
      cwd: project.packageManagerRoot,
      projectRoot: agentTrustRoot,
    });

    if (agents.length === 0) {
      throw new InvalidArgumentError(
        "--apply could not find an eligible Claude Code, Codex CLI, or Grok Build executable on PATH."
      );
    }

    const action = await promptPostScanAction({
      agents,
      includeHandoff: false,
      includePreCommit: false,
    });
    if (action.kind !== "agent") {
      return;
    }
    selectedAgent = action.agentId;
  }

  await runAgent({ agentId: selectedAgent, project, report });
};

const runDefaultPostScanAction = async ({
  category,
  enabled,
  project,
  report,
}: {
  category?: AuditCategory;
  enabled: boolean;
  project: ProjectDiscovery;
  report: Awaited<ReturnType<typeof scanProject>>;
}): Promise<void> => {
  if (!canPromptInteractively(enabled)) {
    return;
  }

  const agentTrustRoot = await resolveAgentTrustRoot(
    project.packageManagerRoot
  );
  const includeHandoff = report.agentHandoff.workItems.length > 0;
  const availableAgents = includeHandoff
    ? await findAgentCliCandidates({
        cwd: project.packageManagerRoot,
        projectRoot: agentTrustRoot,
      })
    : [];
  const detection = canEstablishPreCommitFloor({
    category,
    score: report.score,
    sourceCoverage: report.coverage.source,
  })
    ? await detectPreCommitProtection({ projectRoot: project.rootDir })
    : null;
  const includePreCommit =
    detection !== null &&
    report.score !== null &&
    (detection.status !== "protected-active" ||
      detection.floor === null ||
      detection.floor < report.score);

  if (!includeHandoff && availableAgents.length === 0 && !includePreCommit) {
    return;
  }

  const action = await promptPostScanAction({
    agents: availableAgents,
    includeHandoff,
    includePreCommit,
  });

  if (action.kind === "copy-handoff" || action.kind === "print-handoff") {
    const handoffMarkdown = renderAgentPrompt(stripRoasts(report));
    process.stdout.write(handoffMarkdown);

    if (action.kind === "copy-handoff") {
      const clipboard = await copyToClipboard(handoffMarkdown, {
        osc52Write: (sequence) => process.stderr.write(sequence),
      });
      process.stderr.write(
        clipboard.copied
          ? "\nThe agent handoff is on your clipboard and printed above.\n"
          : "\nClipboard unavailable; the agent handoff is printed above.\n"
      );
    }
    return;
  }

  if (action.kind === "agent") {
    await runAgent({ agentId: action.agentId, project, report });
    return;
  }

  if (action.kind === "pre-commit") {
    if (!detection) {
      return;
    }

    await offerPreCommitInstall(await buildPreCommitPlan({ project, report }));
  }
};

const validateScanActionOptions = (
  options: CliOptions,
  outputFormat: OutputFormat
): void => {
  if (options.agent && !options.apply) {
    throw new InvalidArgumentError("--agent requires --apply.");
  }

  if (options.apply && outputFormat !== "human") {
    throw new InvalidArgumentError("--apply requires human output.");
  }

  if (options.apply && !options.agent && !options.interactive) {
    throw new InvalidArgumentError(
      "--apply without --agent requires interactive selection."
    );
  }
};

const getUiCheckTarget = (options: CliOptions): string | undefined =>
  options.checkUi ?? options.checkOverflow;

const validateUiModeOptions = ({
  command,
  options,
  outputFormat,
  projectPath,
}: {
  command: Command;
  options: CliOptions;
  outputFormat: OutputFormat;
  projectPath: string;
}): void => {
  if (projectPath !== ".") {
    throw new InvalidArgumentError(
      "--check-ui does not accept a project path."
    );
  }

  const incompatibleOption = [
    options.category === undefined ? null : "--category",
    options.failUnder === undefined ? null : "--fail-under",
    options.apply ? "--apply" : null,
    options.agent ? "--agent" : null,
    options.prompt || outputFormat === "prompt" ? "--prompt" : null,
    options.listProjects ? "--list-projects" : null,
    options.project ? "--project" : null,
    command.getOptionValueSource("roast") === "cli" && options.roast === true
      ? "--roast"
      : null,
  ].find((option): option is string => option !== null);

  if (incompatibleOption) {
    throw new InvalidArgumentError(
      `--check-ui cannot be used with ${incompatibleOption}.`
    );
  }
};

const validateFocusedOptions = (options: CliOptions): void => {
  if (getUiCheckTarget(options) !== undefined) {
    return;
  }

  if ((options.route?.length ?? 0) > 0) {
    throw new InvalidArgumentError("--route requires --check-ui.");
  }

  if (options.browserExecutable !== undefined) {
    throw new InvalidArgumentError("--browser-executable requires --check-ui.");
  }
};

const rejectFocusedOptionsForSubcommand = (command: Command): void => {
  const rootOptions = command.parent?.opts<CliOptions>();
  if (
    (rootOptions && getUiCheckTarget(rootOptions) !== undefined) ||
    rootOptions?.browserExecutable !== undefined ||
    (rootOptions?.route?.length ?? 0) > 0
  ) {
    throw new InvalidArgumentError(
      "--check-ui and its related options cannot be used with subcommands."
    );
  }
};

const getOutputTerminalCapabilities = () =>
  resolveTerminalCapabilities({
    columns: process.stdout.columns,
    env: {
      CI: process.env.CI,
      FORCE_COLOR: process.env.FORCE_COLOR,
      NO_COLOR: process.env.NO_COLOR,
      TERM: process.env.TERM,
    },
    isTTY: process.stdout.isTTY === true,
  });

const runUiCheckAction = async (
  {
    browserExecutable,
    outputFormat,
    routes,
    target,
  }: {
    browserExecutable?: string;
    outputFormat: OutputFormat;
    routes?: string[];
    target: string;
  },
  runtime: UiCheckRuntime = {}
): Promise<void> => {
  const resolvedTarget = resolveOverflowCheckTarget({ routes, target });
  let runBrowserCheck = runtime.runBrowserCheck;

  if (!runBrowserCheck) {
    ({ runOverflowBrowserCheck: runBrowserCheck } = await import(
      "./overflow-check/browser"
    ));
  }

  const abortController = new AbortController();
  const abortCheck = (): void => abortController.abort();
  process.once("SIGINT", abortCheck);
  process.once("SIGTERM", abortCheck);

  try {
    const browserResult = await runBrowserCheck({
      browserExecutable,
      origin: resolvedTarget.origin,
      pages: resolvedTarget.pages,
      signal: abortController.signal,
    });
    const report = evaluateOverflowCheck({
      durationMs: browserResult.durationMs,
      measurements: browserResult.measurements,
      target: {
        origin: browserResult.origin,
        pages: resolvedTarget.pages.map((page) => page.displayPath),
      },
    });
    const output =
      outputFormat === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderOverflowCheckReport(report, {
            requestedOrigin: resolvedTarget.origin,
            terminal: getOutputTerminalCapabilities(),
          });

    process.stdout.write(output);
    if (report.status === "fail") {
      process.exitCode = 1;
    }
  } finally {
    process.removeListener("SIGINT", abortCheck);
    process.removeListener("SIGTERM", abortCheck);
  }
};

/**
 * The classification heuristic decides which packages feed the score, so it
 * needs to be inspectable without running a full audit.
 */
const runListProjectsAction = async (
  projectPath: string,
  options: CliOptions
): Promise<void> => {
  const resolvedProjectPath = await resolveProjectPath(projectPath);
  const workspace = await discoverWorkspace(resolvedProjectPath);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(workspace, null, 2)}\n`);
    return;
  }

  const lines = [
    `Workspace: ${workspace.kind}`,
    `Projects: ${workspace.projects.length}`,
    "",
  ];

  for (const project of workspace.projects) {
    lines.push(
      `  ${project.packageDir}  [${project.kind}]  ${project.adapter}`,
      `    ${project.kindReason}`
    );
  }

  if (workspace.skipped.length > 0) {
    lines.push("", "Skipped:");
    for (const skip of workspace.skipped) {
      lines.push(`  ${skip.packageDir} — ${skip.reason}`);
    }
  }

  if (workspace.truncated > 0) {
    lines.push(
      "",
      `${workspace.truncated} application package(s) exceeded the scan cap and were not listed.`
    );
  }

  process.stdout.write(`${lines.join("\n")}\n`);
};

const renderScanOutput = ({
  includeRoast,
  outputFormat,
  report,
}: {
  includeRoast: boolean;
  outputFormat: OutputFormat;
  report: AuditReport;
}): string => {
  const outputReport = includeRoast ? report : stripRoasts(report);

  if (outputFormat === "json") {
    return `${JSON.stringify(outputReport, null, 2)}\n`;
  }

  if (outputFormat === "prompt") {
    return renderAgentPrompt(outputReport);
  }

  const terminal = resolveTerminalCapabilities({
    columns: process.stdout.columns,
    env: {
      CI: process.env.CI,
      FORCE_COLOR: process.env.FORCE_COLOR,
      NO_COLOR: process.env.NO_COLOR,
      TERM: process.env.TERM,
    },
    isTTY: process.stdout.isTTY === true,
  });

  return renderHumanReport(outputReport, { includeRoast, terminal });
};

const runProjectScanPhases = async ({
  category,
  progress,
  projectPath,
}: {
  category?: AuditCategory;
  progress: ScanProgress;
  projectPath: string;
}): Promise<{ project: ProjectDiscovery; report: AuditReport }> => {
  const resolvedProjectPath = await progress.run("Resolving project", () =>
    resolveProjectPath(projectPath)
  );
  const project = await progress.run("Discovering app structure", () =>
    discoverProject(resolvedProjectPath)
  );
  const report = await progress.run("Evaluating UI rules", () =>
    scanProject(project.rootDir, { category })
  );

  return { project, report };
};

const runScanAction = async (
  projectPath: string,
  options: CliOptions,
  command: Command,
  runtime: UiCheckRuntime = {}
): Promise<void> => {
  validateFocusedOptions(options);
  const outputFormat = resolveOutputFormat(options);

  const uiCheckTarget = getUiCheckTarget(options);
  if (uiCheckTarget !== undefined) {
    validateUiModeOptions({
      command,
      options,
      outputFormat,
      projectPath,
    });
    await runUiCheckAction(
      {
        browserExecutable: options.browserExecutable,
        outputFormat,
        routes: options.route,
        target: uiCheckTarget,
      },
      runtime
    );
    return;
  }

  if (options.listProjects) {
    await runListProjectsAction(projectPath, options);
    return;
  }

  validateScanActionOptions(options, outputFormat);
  const roastWasSpecified = command.getOptionValueSource("roast") === "cli";
  const includeRoast =
    outputFormat !== "prompt" &&
    (roastWasSpecified
      ? options.roast !== false
      : outputFormat === "human" && !process.env.CI);
  const progress = createCliScanProgress(
    outputFormat === "human" && options.interactive
  );
  const resolvedProjectPath = await progress.run("Resolving project", () =>
    resolveProjectPath(projectPath)
  );
  const scanTarget = await progress.run(
    "Discovering app structure",
    async () => {
      const workspace = options.project
        ? null
        : await discoverWorkspace(resolvedProjectPath);
      /**
       * Only a lone package at the repository root takes the single-package
       * path, which keeps plain projects byte-identical. Counting applications
       * instead broke the common "one app under apps/, libraries beside it"
       * layout because the root does not declare React.
       */
      const onlyProject =
        workspace?.projects.length === 1 ? workspace.projects[0] : null;
      const scanAsWorkspace =
        workspace !== null &&
        workspace.projects.length > 0 &&
        onlyProject?.packageDir !== ".";

      if (scanAsWorkspace) {
        return {
          kind: "workspace" as const,
          rootDir: resolvedProjectPath,
        };
      }

      const selectedPath = options.project
        ? await resolveProjectPath(
            path.resolve(resolvedProjectPath, options.project)
          )
        : resolvedProjectPath;

      return {
        kind: "project" as const,
        project: await discoverProject(selectedPath),
      };
    }
  );
  const report = await progress.run("Evaluating UI rules", () =>
    scanTarget.kind === "workspace"
      ? scanWorkspace(scanTarget.rootDir, { category: options.category })
      : scanProject(scanTarget.project.rootDir, {
          category: options.category,
        })
  );
  const output = await progress.run("Preparing report", () =>
    renderScanOutput({ includeRoast, outputFormat, report })
  );
  progress.finish();
  process.stdout.write(output);

  if (
    options.failUnder !== undefined &&
    scoreFailsThreshold(report.score, options.failUnder, report.coverage.source)
  ) {
    process.exitCode = 1;
  }

  if (scanTarget.kind === "workspace") {
    return;
  }

  const { project } = scanTarget;

  if (options.apply) {
    await runExplicitApply({ agentId: options.agent, project, report });
    return;
  }

  if (outputFormat === "human") {
    await runDefaultPostScanAction({
      category: options.category,
      enabled: options.interactive,
      project,
      report,
    });
  }
};

const runSetupAction = async (
  projectPath: string,
  options: SetupOptions
): Promise<void> => {
  const progress = createCliScanProgress(canPromptInteractively());
  const { project, report } = await runProjectScanPhases({
    progress,
    projectPath,
  });
  const preparedSetup = await progress.run("Preparing report", async () => {
    const plan = await buildPreCommitPlan({ project, report });

    return {
      output: `Current Shadscan score: ${getPreCommitFloor(report)}/100\n${formatPreCommitInstallPlan(plan)}`,
      plan,
    };
  });
  progress.finish();
  process.stdout.write(preparedSetup.output);
  const { plan } = preparedSetup;

  if (options.dryRun || plan.mode === "not-needed") {
    return;
  }

  if (plan.mode === "manual") {
    process.exitCode = 1;
    return;
  }

  let confirmed = options.yes === true;
  if (!confirmed) {
    if (!canPromptInteractively()) {
      throw new PreCommitError(
        "CONFIRMATION_REQUIRED",
        "Use --yes to apply this pre-commit plan non-interactively, or --dry-run to preview it."
      );
    }
    confirmed = await askForConfirmation("Apply this pre-commit plan?");
  }

  if (!confirmed) {
    process.stderr.write("No files were changed.\n");
    return;
  }

  printAppliedPreCommitResult(
    await applyPreCommitInstallPlan(plan, { confirmed: true })
  );
};

const createProgram = (runtime: UiCheckRuntime = {}): Command => {
  const program = new Command();

  program
    .name("shadscan")
    .description("Audit a React shadcn app for missing UI fundamentals.")
    .version(VERSION)
    .argument("[path]", "Project directory to scan.", ".")
    .addOption(
      new Option(
        "--format <format>",
        "Choose human, JSON, or paste-ready prompt output."
      )
        .argParser(parseOutputFormat)
        .conflicts(["json", "prompt"])
    )
    .addOption(
      new Option(
        "--apply",
        "Open an installed coding-agent CLI with the remediation prompt."
      ).conflicts(["json", "prompt"])
    )
    .addOption(
      new Option(
        "--agent <agent>",
        "Choose claude, codex, or grok for --apply."
      ).argParser(parseAgent)
    )
    .addOption(
      new Option("--json", "Print a machine-readable JSON report.").conflicts([
        "format",
        "prompt",
      ])
    )
    .addOption(
      new Option(
        "--prompt",
        "Print only a paste-ready prompt for an AI agent."
      ).conflicts(["format", "json"])
    )
    .option(
      "--fail-under <score>",
      "Exit non-zero when the score is below this number, unassessed, or based on partial source coverage.",
      parseScore
    )
    .option(
      "--category <category>",
      "Run only one audit category.",
      parseCategory
    )
    .addOption(
      new Option(
        "--check-ui <url>",
        "Run rendered UI checks at mobile and desktop widths."
      ).conflicts("checkOverflow")
    )
    .addOption(
      new Option(
        "--check-overflow <url>",
        "Legacy alias for --check-ui."
      ).hideHelp()
    )
    .option(
      "--route <path>",
      "Add a same-origin route to --check-ui (repeatable).",
      collectRoute
    )
    .option(
      "--browser-executable <path>",
      "Use a specific Chromium executable for --check-ui."
    )
    .option("--no-roast", "Use neutral human output.")
    .option("--roast", "Force roast copy in CI and JSON output.")
    .option("--no-interactive", "Disable Shadscan follow-up prompts.")
    .option(
      "--list-projects",
      "List the workspace packages shadscan found, without scanning."
    )
    .option(
      "--project <path>",
      "Scan one workspace package instead of pooling every application."
    )
    .action(
      async (projectPath: string, options: CliOptions, command: Command) => {
        await runScanAction(projectPath, options, command, runtime);
      }
    );

  program
    .command("setup")
    .description("Configure an explicit Shadscan project integration.")
    .argument("[path]", "Project directory to configure.", ".")
    .requiredOption(
      "--pre-commit",
      "Create or extend a score-preserving pre-commit hook."
    )
    .option("--dry-run", "Print the exact plan without changing files.")
    .addOption(
      new Option(
        "--yes",
        "Apply the displayed pre-commit plan without prompting."
      ).conflicts("dryRun")
    )
    .action(
      async (projectPath: string, options: SetupOptions, command: Command) => {
        rejectFocusedOptionsForSubcommand(command);
        await runSetupAction(projectPath, options);
      }
    );

  program
    .command("mcp")
    .description(
      "Serve shadscan as an MCP server over stdio for coding agents."
    )
    .argument("[paths...]", "Root directories tool calls may scan.", undefined)
    .action(async (paths: string[], command: Command) => {
      rejectFocusedOptionsForSubcommand(command);
      // stdout carries JSON-RPC exclusively in this mode; the server writes
      // its one startup line to stderr. Lazy import keeps the MCP bundle out
      // of ordinary scan startup.
      const { runMcpServer } = await import("./mcp/server");
      await runMcpServer(paths ?? []);
    });

  return program;
};

const runCli = async (argv: string[] = process.argv): Promise<void> => {
  const program = createProgram();

  if (wantsJsonOutput(argv)) {
    program.exitOverride();
    program.configureOutput({ writeErr: () => undefined });
  }

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      return;
    }

    throw error;
  }
};

export {
  canEstablishPreCommitFloor,
  createProgram,
  resolveProjectPath,
  runCli,
  runUiCheckAction,
  scoreFailsThreshold,
};
