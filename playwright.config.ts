import { defineConfig, devices } from "@playwright/test";

const BASE_URL =
  process.env.E2E_BASE_URL ??
  "https://id-preview--22faf248-7cd1-4fba-86f4-829982532ce6.lovable.app";

export default defineConfig({
  testDir: "./e2e/specs",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e/report-html" }],
    ["json", { outputFile: "e2e/report.json" }],
    ["./e2e/lib/audit-reporter.ts"],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /global\.setup\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.CHROMIUM_PATH
          ? { executablePath: process.env.CHROMIUM_PATH }
          : undefined,
      },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/admin.json",
        launchOptions: process.env.CHROMIUM_PATH
          ? { executablePath: process.env.CHROMIUM_PATH }
          : undefined,
      },
      dependencies: ["setup"],
    },
  ],
});
