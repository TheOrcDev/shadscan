import type { NextConfig } from "next";

const SCANNER_TRACE_EXCLUDES = [
  "./.claude/**/*",
  "./.git",
  "./.git/**/*",
  "./app/**/*",
  "./changelog/**/*",
  // Common directory names must not strip matching JavaScript from Next.
  "./components/**/*.{ts,tsx}",
  "./design/**/*",
  "./docs/**/*",
  "./drizzle/**/*",
  "./hooks/**/*",
  "./lib/**/*.ts",
  "./lib/generated/**/*",
  "./plans/**/*",
  "./packages/cli/src/**/*",
  "./packages/cli/test/**/*",
  "./playwright-report/**/*",
  "./public/**/*",
  "./scripts/**/*",
  "./test/**/*",
  "./test-results/**/*",
  "./AGENTS.md",
  "./CHANGELOG.md",
  "./CONTRIBUTING.md",
  "./LICENSE.md",
  "./README.md",
  "./SECURITY.md",
  "./action.yml",
  "./biome.jsonc",
  "./components.json",
  "./drizzle.config.ts",
  "./eslint.config.mjs",
  "./next.config.ts",
  "./packages/cli/README.md",
  "./packages/cli/dist/cli.*",
  "./packages/cli/package.json",
  "./packages/cli/tsconfig.json",
  "./packages/cli/tsup.config.ts",
  "./pnpm-lock.yaml",
  "./pnpm-workspace.yaml",
  "./playwright.config.ts",
  "./postcss.config.mjs",
  "./skills-lock.json",
  "./tsconfig.json",
  "./tsconfig.tsbuildinfo",
  "./vercel.json",
  "./vitest.config.ts",
] as const;
const SCANNER_TRACE_INCLUDES = [
  "./.shadscan-runtime/index.js",
  "./lib/shadscan-api/hosted-scan-worker.mjs",
  "./packages/cli/LICENSE",
] as const;

const nextConfig: NextConfig = {
  experimental:
    process.env.SHADSCAN_E2E === "1" ? { testProxy: true } : undefined,
  outputFileTracingExcludes: {
    "/api/queues/shadscan": [...SCANNER_TRACE_EXCLUDES],
    "/scan": [...SCANNER_TRACE_EXCLUDES],
    "/v1/scans": [...SCANNER_TRACE_EXCLUDES],
  },
  outputFileTracingIncludes: {
    "/api/queues/shadscan": [...SCANNER_TRACE_INCLUDES],
    "/v1/scans": [...SCANNER_TRACE_INCLUDES],
  },
  serverExternalPackages: ["@shadscan/cli"],
  turbopack: {
    ignoreIssue: [{ path: "**/next.config.ts" }],
  },
};

export default nextConfig;
