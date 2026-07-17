import { Command, InvalidArgumentError } from "commander";
import packageJson from "../package.json";
import { AUDIT_CATEGORIES, type RunAuditOptions, runAudit } from "./audit";
import { renderHumanReport, stripRoasts } from "./render-human";
import { defaultRules } from "./rules/default-rules";

const VERSION = packageJson.version;

interface CliOptions {
  category?: RunAuditOptions["category"];
  failUnder?: number;
  json?: boolean;
  roast?: boolean;
}

const parseScore = (value: string): number => {
  const score = Number(value);

  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new InvalidArgumentError("Expected an integer between 0 and 100.");
  }

  return score;
};

const parseCategory = (value: string): RunAuditOptions["category"] => {
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

const createProgram = (): Command => {
  const program = new Command();

  program
    .name("shadscan")
    .description("Audit a React shadcn app for missing UI fundamentals.")
    .version(VERSION)
    .option("--json", "Print a machine-readable JSON report.")
    .option(
      "--fail-under <score>",
      "Exit non-zero when the score is below this number.",
      parseScore
    )
    .option(
      "--category <category>",
      "Run only one audit category.",
      parseCategory
    )
    .option("--no-roast", "Use neutral human output.")
    .option("--roast", "Force roast copy in CI and JSON output.")
    .action(async (options: CliOptions) => {
      const explicitNoRoast = process.argv.includes("--no-roast");
      const explicitRoast = process.argv.includes("--roast");
      const includeRoast =
        explicitRoast || !(options.json || explicitNoRoast || process.env.CI);
      const report = await runAudit(process.cwd(), {
        category: options.category,
        rules: defaultRules,
      });
      const outputReport = includeRoast ? report : stripRoasts(report);

      if (options.json) {
        process.stdout.write(`${JSON.stringify(outputReport, null, 2)}\n`);
      } else {
        process.stdout.write(renderHumanReport(outputReport, { includeRoast }));
      }

      if (options.failUnder !== undefined && report.score < options.failUnder) {
        process.exitCode = 1;
      }
    });

  return program;
};

const runCli = async (argv: string[] = process.argv): Promise<void> => {
  await createProgram().parseAsync(argv);
};

export { createProgram, runCli };
