import { defineConfig, devices } from "@playwright/test";

// In CI: serve the pre-built dist via `vite preview` (port 4173) — more stable than dev server.
// Locally: reuse whatever server is already running on port 5173.
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? "github" : "list",
  use: {
    baseURL: isCI ? "http://localhost:4173" : "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: isCI
    ? {
        command: "npm run preview",
        url: "http://localhost:4173",
        reuseExistingServer: false,
        timeout: 60_000,
      }
    : {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
