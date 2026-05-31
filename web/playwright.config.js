import { defineConfig, devices } from "@playwright/test";

// CI uses port 4173 (vite preview, started manually in workflow).
// Local dev uses port 5173 (vite dev server).
const isCI = !!process.env.CI;
const baseURL = isCI ? "http://localhost:4173" : "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // reuseExistingServer: true — in CI the server is pre-started by the workflow;
  // locally the dev server is typically already running.
  webServer: {
    command: isCI ? "npm run preview" : "npm run dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
