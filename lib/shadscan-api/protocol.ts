const HOSTED_AUDIT_CATEGORIES = [
  "foundation",
  "interaction",
  "states",
  "accessibility",
  "forms",
  "production-polish",
] as const;

const HOSTED_SCAN_SCHEMA_VERSION = 1 as const;
const SNAPSHOT_MEDIA_TYPE = "application/vnd.shadscan.snapshot+tar+gzip";
const MARKDOWN_MEDIA_TYPE = "text/markdown";
const JSON_MEDIA_TYPE = "application/json";

const PUBLIC_CONTRACT_VERSIONS = {
  prompt: 3,
  report: 3,
  scan: HOSTED_SCAN_SCHEMA_VERSION,
} as const;

export {
  HOSTED_AUDIT_CATEGORIES,
  HOSTED_SCAN_SCHEMA_VERSION,
  JSON_MEDIA_TYPE,
  MARKDOWN_MEDIA_TYPE,
  PUBLIC_CONTRACT_VERSIONS,
  SNAPSHOT_MEDIA_TYPE,
};
