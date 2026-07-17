import path from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import packageJson from "../package.json";
import { AUDIT_CATEGORIES, type AuditCategory } from "./audit";
import {
  type OutputFormat,
  parseOutputFormat,
  resolveOutputFormat,
} from "./output-format";
import { renderAgentPrompt } from "./render-agent-prompt";
import { renderHumanReport, stripRoasts } from "./render-human";
import { scanProject } from "./scan";

const VERSION = packageJson.version;

interface CliOptions {
  category?: AuditCategory;
  failUnder?: number;
  format?: OutputFormat;
  json?: boolean;
  prompt?: boolean;
  roast?: boolean;
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

const scoreFailsThreshold = (
  score: number | null,
  threshold: number
): boolean => score === null || score < threshold;

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
      "Exit non-zero when the score is below this number or is unassessed.",
      parseScore
    )
    .option(
      "--category <category>",
      "Run only one audit category.",
      parseCategory
    )
    .option("--no-roast", "Use neutral human output.")
    .option("--roast", "Force roast copy in CI and JSON output.")
    .action(
      async (projectPath: string, options: CliOptions, command: Command) => {
        const outputFormat = resolveOutputFormat(options);
        const roastWasSpecified =
          command.getOptionValueSource("roast") === "cli";
        const includeRoast =
          outputFormat !== "prompt" &&
          (roastWasSpecified
            ? options.roast !== false
            : outputFormat === "human" && !process.env.CI);
        const report = await scanProject(
          path.resolve(process.cwd(), projectPath),
          {
            category: options.category,
          }
        );
        const outputReport = includeRoast ? report : stripRoasts(report);

        if (outputFormat === "json") {
          process.stdout.write(`${JSON.stringify(outputReport, null, 2)}\n`);
        } else if (outputFormat === "prompt") {
          process.stdout.write(renderAgentPrompt(outputReport));
        } else {
          process.stdout.write(
            renderHumanReport(outputReport, { includeRoast })
          );
        }

        if (
          options.failUnder !== undefined &&
          scoreFailsThreshold(report.score, options.failUnder)
        ) {
          process.exitCode = 1;
        }
      }
    );

  return program;
};

const runCli = async (argv: string[] = process.argv): Promise<void> => {
  await createProgram().parseAsync(argv);
};

export { createProgram, runCli, scoreFailsThreshold };
