import { defineConfig } from "@playwright/test";

// Explicit opt-in suite: requires the local demo-loci-review Auth/RTDB emulators.
// Kept outside e2e/ so ordinary CI never needs emulator credentials or services.
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.js",
  outputDir: "../test-results/alpha-review",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    serviceWorkers: "block",
    launchOptions: process.env.LOCI_REVIEW_CHROMIUM
      ? { executablePath: process.env.LOCI_REVIEW_CHROMIUM }
      : {},
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
