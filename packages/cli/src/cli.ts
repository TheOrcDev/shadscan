import { Command, InvalidArgumentError } from "commander";
import { AUDIT_CATEGORIES, type RunAuditOptions, runAudit } from "./audit";
import { defaultRules } from "./rules/default-rules";

const VERSION = "0.0.1";

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
    .name("headless-shadcn")
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
    .action(async (options: CliOptions) => {
      const report = await runAudit(process.cwd(), {
        category: options.category,
        rules: defaultRules,
      });

      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(`Your Shadcn app score: ${report.score}/100\n`);
        process.stdout.write(`Grade: ${report.grade}\n`);

        process.stdout.write(`${report.findings.length} findings checked.\n`);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  await runCli();
}

export { createProgram, runCli };
