import { CommanderError } from "commander";
import { AgentCliError, type AgentCliErrorCode } from "./agent-cli";
import {
  ProjectDiscoveryError,
  type ProjectDiscoveryErrorCode,
} from "./discovery";
import {
  OverflowCheckError,
  type OverflowCheckErrorCode,
} from "./overflow-check/error";
import { PreCommitError, type PreCommitErrorCode } from "./pre-commit";
import { ScanConfigError } from "./scan-ignores";

const COMMANDER_ERROR_PREFIX_PATTERN = /^error:\s*/i;

interface CliFailure {
  code:
    | "AUDIT_FAILED"
    | "INVALID_ARGUMENTS"
    | "INVALID_PROJECT_METADATA"
    | AgentCliErrorCode
    | OverflowCheckErrorCode
    | PreCommitErrorCode
    | ProjectDiscoveryErrorCode
    | "INVALID_SCAN_CONFIG";
  message: string;
}

const normalizeCliFailure = (error: unknown): CliFailure => {
  if (error instanceof OverflowCheckError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof AgentCliError || error instanceof PreCommitError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof ScanConfigError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof ProjectDiscoveryError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof CommanderError) {
    return {
      code: "INVALID_ARGUMENTS",
      message: error.message.replace(COMMANDER_ERROR_PREFIX_PATTERN, ""),
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
