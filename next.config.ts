import type { NextConfig } from "next";

const SCANNER_TRACE_EXCLUDES = [
  "./app/**/*",
  "./components/**/*",
  "./docs/**/*",
  "./lib/**/*",
  "./packages/cli/src/**/*",
  "./packages/cli/test/**/*",
  "./scripts/**/*",
  "./test/**/*",
  "./AGENTS.md",
  "./CHANGELOG.md",
  "./README.md",
  "./biome.jsonc",
  "./components.json",
  "./eslint.config.mjs",
  "./next.config.ts",
  "./packages/cli/README.md",
  "./packages/cli/dist/cli.*",
  "./packages/cli/package.json",
  "./packages/cli/tsconfig.json",
  "./packages/cli/tsup.config.ts",
  "./pnpm-lock.yaml",
  "./pnpm-workspace.yaml",
  "./postcss.config.mjs",
  "./tsconfig.json",
  "./tsconfig.tsbuildinfo",
] as const;

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/scan": [...SCANNER_TRACE_EXCLUDES],
    "/v1/scans": [...SCANNER_TRACE_EXCLUDES],
  },
  serverExternalPackages: ["shadscan"],
  turbopack: {
    ignoreIssue: [{ path: "**/next.config.ts" }],
  },
};

export default nextConfig;
