import { defineConfig } from "tsup";

export default defineConfig({
  banner: {
    js: "#!/usr/bin/env node",
  },
  clean: true,
  dts: true,
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node18",
});
