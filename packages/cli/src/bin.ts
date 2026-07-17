import { runCli } from "./cli";
import { normalizeCliFailure } from "./cli-error";

const ERROR_SCHEMA_VERSION = 1;

try {
  await runCli();
} catch (error) {
  const failure = normalizeCliFailure(error);
  const output = process.argv.includes("--json")
    ? JSON.stringify(
        {
          error: failure,
          schemaVersion: ERROR_SCHEMA_VERSION,
        },
        null,
        2
      )
    : `Shadscan could not audit this project: ${failure.message}`;

  process.stderr.write(`${output}\n`);
  process.exitCode = 1;
}
