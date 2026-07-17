import { InvalidArgumentError } from "commander";

const OUTPUT_FORMATS = ["human", "json", "prompt"] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

interface OutputOptions {
  format?: OutputFormat;
  json?: boolean;
  prompt?: boolean;
}

const parseOutputFormat = (value: string): OutputFormat => {
  const format = OUTPUT_FORMATS.find((candidate) => candidate === value);

  if (!format) {
    throw new InvalidArgumentError(
      `Expected one of: ${OUTPUT_FORMATS.join(", ")}.`
    );
  }

  return format;
};

const resolveOutputFormat = (options: OutputOptions): OutputFormat => {
  if (options.json) {
    return "json";
  }

  if (options.prompt) {
    return "prompt";
  }

  return options.format ?? "human";
};

const wantsJsonOutput = (argv: string[]): boolean => {
  for (const [index, argument] of argv.entries()) {
    if (argument === "--json" || argument === "--format=json") {
      return true;
    }

    if (argument === "--format" && argv[index + 1] === "json") {
      return true;
    }
  }

  return false;
};

export type { OutputFormat, OutputOptions };
export {
  OUTPUT_FORMATS,
  parseOutputFormat,
  resolveOutputFormat,
  wantsJsonOutput,
};
