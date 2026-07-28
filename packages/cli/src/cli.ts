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
import { resolveTerminalCapabilities } from "./terminal-capabilities";

const VERSION = packageJson.version;

interface CliOptions {
  agent?: AgentId;
  apply?: boolean;
  category?: AuditCategory;
  failUnder?: number;
  format?: OutputFormat;
  interactive: boolean;
  json?: boolean;
  prompt?: boolean;
  roast?: boolean;
}

interface SetupOptions {
  dryRun?: boolean;
  preCommit: boolean;
  yes?: boolean;
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

const createCliScanProgress = (enabled: boolean): ScanProgress =>
  createScanProgress({
    enabled,
    output: process.stderr,
    terminal: resolveTerminalCapabilities({
      columns: process.stderr.columns,
      env: {
        CI: process.env.CI,
        FORCE_COLOR: process.env.FORCE_COLOR,
        NO_COLOR: process.env.NO_COLOR,
        TERM: process.env.TERM,
      },
      isTTY: process.stderr.isTTY === true,
    }),
  });

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

const runScanAction = async (
  projectPath: string,
  options: CliOptions,
  command: Command
): Promise<void> => {
  const outputFormat = resolveOutputFormat(options);
  validateScanActionOptions(options, outputFormat);
  const roastWasSpecified = command.getOptionValueSource("roast") === "cli";
  const includeRoast =
    outputFormat !== "prompt" &&
    (roastWasSpecified
      ? options.roast !== false
      : outputFormat === "human" && !process.env.CI);
  const progress = createCliScanProgress(
    outputFormat === "human" &&
      canPromptInteractively(options.interactive)
  );
  const resolvedProjectPath = await progress.run("Resolving project", () =>
    resolveProjectPath(projectPath)
  );
  const project = await progress.run("Discovering app structure", () =>
    discoverProject(resolvedProjectPath)
  );
  const report = await progress.run("Evaluating UI rules", () =>
    scanProject(project.rootDir, {
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
  const resolvedProjectPath = await progress.run("Resolving project", () =>
    resolveProjectPath(projectPath)
  );
  const project = await progress.run("Discovering app structure", () =>
    discoverProject(resolvedProjectPath)
  );
  const report = await progress.run("Evaluating UI rules", () =>
    scanProject(project.rootDir)
  );
  const prepared = await progress.run("Preparing report", async () => {
    const plan = await buildPreCommitPlan({ project, report });

    return {
      output: `Current Shadscan score: ${getPreCommitFloor(report)}/100\n${formatPreCommitInstallPlan(plan)}`,
      plan,
    };
  });
  progress.finish();
  process.stdout.write(prepared.output);
  const { plan } = prepared;

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

const createProgram = (): Command => {
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
    .option("--no-roast", "Use neutral human output.")
    .option("--roast", "Force roast copy in CI and JSON output.")
    .option("--no-interactive", "Disable Shadscan follow-up prompts.")
    .action(runScanAction);

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
    .action(runSetupAction);

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
  scoreFailsThreshold,
};
