import { defineConfig } from "tsup";

const banner = {
  js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
};
const hostedRuntimeBanner = {
  js: 'import { createRequire as createHostedRuntimeRequire } from "node:module"; import { dirname as getHostedRuntimeDirname } from "node:path"; import { fileURLToPath as hostedRuntimeFileURLToPath } from "node:url"; const __filename = hostedRuntimeFileURLToPath(import.meta.url); const __dirname = getHostedRuntimeDirname(__filename); const require = createHostedRuntimeRequire(import.meta.url);',
};

const configureEsbuild = (options: { sourcesContent?: boolean }): void => {
  options.sourcesContent = false;
};

export default defineConfig([
  {
    banner,
    clean: true,
    dts: true,
    entry: {
      cli: "src/bin.ts",
      index: "src/index.ts",
    },
    esbuildOptions: configureEsbuild,
    format: ["esm"],
    // The MCP SDK (and the validator family its server core imports) is a
    // devDependency bundled into dist, mirroring commander: users install
    // six runtime deps, not an HTTP stack. cli:smoke audits the emitted
    // bundle for the SDK's HTTP-transport modules.
    noExternal: [
      "commander",
      /^@modelcontextprotocol\/sdk/,
      "ajv",
      "ajv-formats",
      "json-schema-typed",
      "zod-to-json-schema",
      "eventsource-parser",
      "content-type",
    ],
    platform: "node",
    sourcemap: true,
    splitting: false,
    target: "node18",
  },
  {
    banner: hostedRuntimeBanner,
    clean: true,
    dts: false,
    entry: {
      index: "src/index.ts",
    },
    esbuildOptions: configureEsbuild,
    format: ["esm"],
    noExternal: [/.*/],
    outDir: "../../.shadscan-runtime",
    platform: "node",
    sourcemap: false,
    splitting: false,
    target: "node18",
  },
]);
