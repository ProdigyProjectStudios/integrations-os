import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 20000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL: "http://127.0.0.1:5180",
    // Local built-artifact tests emulate the identity headers supplied by Sites
    // dispatch. These are test fixtures, never a production authentication mode.
    extraHTTPHeaders: {
      "oai-authenticated-user-id":
        process.env.IOS_TEST_USER || "browser-regression-test",
      "oai-authenticated-user-email": "browser-test@example.test",
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://127.0.0.1:5180/api/health",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
