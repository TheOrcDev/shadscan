#!/usr/bin/env node

import { runCli } from "./cli";
import { normalizeCliFailure } from "./cli-error";
import { wantsJsonOutput } from "./output-format";

const ERROR_SCHEMA_VERSION = 1;

try {
  await runCli();
} catch (error) {
  const failure = normalizeCliFailure(error);
  const output = wantsJsonOutput(process.argv)
    ? JSON.stringify(
        {
          error: failure,
          schemaVersion: ERROR_SCHEMA_VERSION,
        },
        null,
        2
      )
    : `shadscan could not audit this project: ${failure.message}`;

  process.stderr.write(`${output}\n`);
  process.exitCode = 1;
}
