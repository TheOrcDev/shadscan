"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { WebScanErrorStateSchema } from "@/lib/shadscan-web/contracts";
import { toWebScanError } from "@/lib/shadscan-web/errors";
import { writeWebScanLog } from "@/lib/shadscan-web/log";
import { executeWebRepositoryScan } from "@/lib/shadscan-web/run-repository-scan";
import {
  MAX_REPOSITORY_INPUT_LENGTH,
  type WebScanState,
} from "@/lib/shadscan-web/types";

interface HeaderReader {
  get(name: string): string | null;
}

const FORWARDED_HEADER_NAMES = [
  "x-vercel-forwarded-for",
  "x-forwarded-for",
  "x-real-ip",
] as const;
const FORWARDED_ADDRESS_SEPARATOR = ",";
const MAX_CLIENT_ADDRESS_LENGTH = 128;

const getClientAddress = (requestHeaders: HeaderReader): string => {
  for (const headerName of FORWARDED_HEADER_NAMES) {
    const address = requestHeaders
      .get(headerName)
      ?.split(FORWARDED_ADDRESS_SEPARATOR, 1)[0]
      ?.trim();
    if (address) {
      return address.slice(0, MAX_CLIENT_ADDRESS_LENGTH);
    }
  }

  return "unknown";
};

const getBoundedRepositoryInput = (value: FormDataEntryValue | null): string =>
  typeof value === "string" ? value.slice(0, MAX_REPOSITORY_INPUT_LENGTH) : "";

const scanGitHubRepository = async (
  _previousState: WebScanState,
  formData: FormData
): Promise<WebScanState> => {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const repositoryValue = formData.get("repository");
  const repositoryInput = getBoundedRepositoryInput(repositoryValue);

  try {
    const requestHeaders = await headers();
    const result = await executeWebRepositoryScan({
      clientAddress: getClientAddress(requestHeaders),
      repositoryInput: repositoryValue,
    });
    const { report, scan } = result.result;
    writeWebScanLog({
      actionableCount: report.agentHandoff.workItems.length,
      durationMs: Date.now() - startedAt,
      engineVersion: scan.engineVersion,
      event: "web_scan",
      outcome: "completed",
      repository: result.repository,
      requestId,
      resolvedRevision: scan.resolvedRevision,
      rulesetVersion: scan.rulesetVersion,
      score: report.score,
    });
    return result;
  } catch (error) {
    const publicError = toWebScanError(error);
    writeWebScanLog({
      durationMs: Date.now() - startedAt,
      errorCode: publicError.code,
      event: "web_scan",
      outcome: "failed",
      requestId,
    });
    return WebScanErrorStateSchema.parse({
      error: publicError,
      repositoryInput,
      status: "error",
    });
  }
};

export { scanGitHubRepository };
