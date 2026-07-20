import {
  ProjectDiscoveryError,
  type ProjectDiscoveryErrorCode,
} from "./discovery";

interface CliFailure {
  code: "AUDIT_FAILED" | "INVALID_PROJECT_METADATA" | ProjectDiscoveryErrorCode;
  message: string;
}

const normalizeCliFailure = (error: unknown): CliFailure => {
  if (error instanceof ProjectDiscoveryError) {
    return {
      code: error.code,
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
    message: "shadscan could not complete the audit.",
  };
};

export type { CliFailure };
export { normalizeCliFailure };
