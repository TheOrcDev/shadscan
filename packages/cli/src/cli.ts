import { Command, InvalidArgumentError } from "commander";

const VERSION = "0.0.1";

interface CliOptions {
  category?: string;
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
    .option("--category <category>", "Run only one audit category.")
    .option("--no-roast", "Use neutral human output.")
    .action((options: CliOptions) => {
      const report = {
        durationMs: 0,
        findings: [],
        maxScore: 100,
        message: "Audit engine scaffold is ready.",
        score: 0,
      };

      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }

      process.stdout.write("Headless Shadcn CLI scaffold ready.\n");
      process.stdout.write("Audit engine lands in the next slice.\n");
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
