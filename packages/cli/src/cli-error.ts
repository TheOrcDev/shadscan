import { ProjectDiscoveryError } from "./discovery";

interface CliFailure {
  code: "AUDIT_FAILED" | "INVALID_PROJECT_METADATA" | "PROJECT_NOT_FOUND";
  message: string;
}

const normalizeCliFailure = (error: unknown): CliFailure => {
  if (error instanceof ProjectDiscoveryError) {
    return {
      code: "PROJECT_NOT_FOUND",
      message: error.message,
    };
  }

  if (error instanceof SyntaxError) {
    return {
      code: "INVALID_PROJECT_METADATA",
      message: "Project metadata could not be parsed.",
    };
  }

  return {
    code: "AUDIT_FAILED",
    message: "Shadscan could not complete the audit.",
  };
};

export type { CliFailure };
export { normalizeCliFailure };
