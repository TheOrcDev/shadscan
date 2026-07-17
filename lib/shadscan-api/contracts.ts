import {
  type AuditCategory,
  AuditReportSchema,
  AGENT_PROMPT_VERSION as SCANNER_PROMPT_VERSION,
  AUDIT_REPORT_SCHEMA_VERSION as SCANNER_REPORT_SCHEMA_VERSION,
} from "shadscan";
import { z } from "zod";
import {
  PUBLIC_CONTRACT_VERSIONS as CONTRACT_VERSIONS,
  HOSTED_AUDIT_CATEGORIES,
  HOSTED_SCAN_SCHEMA_VERSION as SCAN_SCHEMA_VERSION,
} from "./protocol";

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const GITHUB_REVISION_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SCAN_ID_PATTERN = /^scan_[a-f0-9]{32}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const isPortableSubdirectory = (value: string): boolean => {
  if (value === ".") {
    return true;
  }

  if (
    value.length > 512 ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    value.includes("\0") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
  ) {
    return false;
  }

  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
};

const isGitHubRepository = (value: string): boolean => {
  const [owner, repository, ...rest] = value.split("/");
  return (
    rest.length === 0 &&
    owner !== undefined &&
    repository !== undefined &&
    GITHUB_OWNER_PATTERN.test(owner) &&
    GITHUB_REPOSITORY_PATTERN.test(repository)
  );
};

const isGitHubRevision = (value: string): boolean =>
  GITHUB_REVISION_PATTERN.test(value) &&
  !value.includes("..") &&
  !value.includes("//") &&
  !value.includes("@{") &&
  !value.startsWith("/") &&
  !value.endsWith("/") &&
  !value.endsWith(".lock");

if (
  SCANNER_PROMPT_VERSION !== CONTRACT_VERSIONS.prompt ||
  SCANNER_REPORT_SCHEMA_VERSION !== CONTRACT_VERSIONS.report
) {
  throw new Error("Hosted API and scanner contract versions are out of sync.");
}

const HostedScanCategorySchema = z.enum(HOSTED_AUDIT_CATEGORIES);
const PortableSubdirectorySchema = z
  .string()
  .min(1)
  .refine(isPortableSubdirectory, "Expected a project-relative POSIX path.");

const GitHubSourceSchema = z
  .object({
    kind: z.literal("github"),
    repository: z
      .string()
      .min(3)
      .max(140)
      .refine(isGitHubRepository, "Expected a GitHub owner/repository name."),
    revision: z
      .string()
      .refine(isGitHubRevision, "Expected a valid GitHub revision.")
      .default("HEAD"),
    subdirectory: PortableSubdirectorySchema.default("."),
  })
  .strict();

const GitHubScanRequestSchema = z
  .object({
    category: HostedScanCategorySchema.optional(),
    source: GitHubSourceSchema,
  })
  .strict();

const SnapshotScanQuerySchema = z
  .object({
    category: HostedScanCategorySchema.optional(),
    subdirectory: PortableSubdirectorySchema.default("."),
  })
  .strict();

const CompletedHostedScanSchema = z
  .object({
    engineVersion: z.string().min(1),
    id: z.string().regex(SCAN_ID_PATTERN),
    resolvedRevision: z.string().min(1).nullable(),
    rulesetVersion: z.string().min(1),
    sourceDigest: z.string().regex(SHA256_DIGEST_PATTERN),
    status: z.literal("completed"),
  })
  .strict();

const HostedScanResponseSchema = z
  .object({
    handoff: z
      .object({
        promptMarkdown: z.string().min(1),
        promptVersion: z.literal(CONTRACT_VERSIONS.prompt),
      })
      .strict(),
    report: AuditReportSchema,
    scan: CompletedHostedScanSchema,
    schemaVersion: z.literal(SCAN_SCHEMA_VERSION),
  })
  .strict();

const HostedScanErrorBodySchema = z
  .object({
    error: z
      .object({
        code: z.string().regex(ERROR_CODE_PATTERN),
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .strict(),
    schemaVersion: z.literal(SCAN_SCHEMA_VERSION),
  })
  .strict();

type CompletedHostedScan = z.infer<typeof CompletedHostedScanSchema>;
type HostedScanErrorBody = z.infer<typeof HostedScanErrorBodySchema>;
type HostedScanResponse = z.infer<typeof HostedScanResponseSchema>;

interface MaterializedScanSource {
  category?: AuditCategory;
  cleanupDirectory: string;
  projectRoot: string;
  resolvedRevision: string | null;
  sourceDigest: string;
  sourceKind: "git" | "snapshot";
}

export type {
  CompletedHostedScan,
  HostedScanErrorBody,
  HostedScanResponse,
  MaterializedScanSource,
};
export {
  CompletedHostedScanSchema,
  GitHubScanRequestSchema,
  GitHubSourceSchema,
  HostedScanCategorySchema,
  HostedScanErrorBodySchema,
  HostedScanResponseSchema,
  PortableSubdirectorySchema,
  SnapshotScanQuerySchema,
};
