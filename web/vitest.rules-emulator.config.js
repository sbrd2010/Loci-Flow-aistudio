import { defineConfig } from "vite";

// Separate vitest config for the live-emulator security-rules test, kept
// out of the default `npx vitest run` sweep (vite.config.js's `include`
// only matches src/**/*.test.{js,ts}) since this one needs a running RTDB
// emulator and every other test in this repo deliberately does not. Also
// deliberately NOT under web/e2e/ — that's Playwright's testDir, and
// Playwright auto-discovers *.test.js there and tries to run it with its
// own runner, which crashes on this file's vitest imports.
export default defineConfig({
  test: {
    environment: "node",
    include: ["emulator-tests/security-rules.emulator.test.js"],
  },
});
