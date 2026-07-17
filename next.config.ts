import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/v1/scans": [
      "./app/**/*",
      "./components/**/*",
      "./lib/**/*",
      "./packages/cli/src/**/*",
      "./packages/cli/test/**/*",
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
    ],
  },
  serverExternalPackages: ["shadscan"],
  turbopack: {
    ignoreIssue: [{ path: "**/next.config.ts" }],
  },
};

export default nextConfig;
