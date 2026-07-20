import { defineConfig } from "tsup";

export default defineConfig({
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  clean: true,
  dts: true,
  entry: {
    cli: "src/bin.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  noExternal: ["commander"],
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node18",
});
