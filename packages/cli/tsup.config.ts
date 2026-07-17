import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: {
    cli: "src/bin.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node18",
});
