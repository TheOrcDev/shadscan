import { defineConfig, devices } from "@playwright/test";

const E2E_PORT = 3210;
const baseURL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  expect: { timeout: 10_000 },
  fullyParallel: false,
  outputDir: "test-results",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: [["list"], ["html", { open: "never" }]],
  testDir: "./test/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 45_000,
  use: {
    baseURL,
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node_modules/.bin/next dev --hostname 127.0.0.1 --port ${E2E_PORT}`,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      SHADSCAN_E2E: "1",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
  workers: 1,
});
