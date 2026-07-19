import type { NextConfig } from "next";

const SCANNER_TRACE_EXCLUDES = [
  "./app/**/*",
  "./components/**/*",
  "./docs/**/*",
  "./hooks/**/*",
  "./lib/**/*",
  "./plans/**/*",
  "./packages/cli/src/**/*",
  "./packages/cli/test/**/*",
  "./playwright-report/**/*",
  "./scripts/**/*",
  "./test/**/*",
  "./test-results/**/*",
  "./AGENTS.md",
  "./CHANGELOG.md",
  "./README.md",
  "./SECURITY.md",
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
  "./playwright.config.ts",
  "./postcss.config.mjs",
  "./skills-lock.json",
  "./tsconfig.json",
  "./tsconfig.tsbuildinfo",
  "./vitest.config.ts",
] as const;

const nextConfig: NextConfig = {
  experimental:
    process.env.SHADSCAN_E2E === "1" ? { testProxy: true } : undefined,
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
