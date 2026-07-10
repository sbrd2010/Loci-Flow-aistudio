import { defineConfig } from "vite";

// Separate vitest config for the live-emulator security-rules test, kept
// out of the default `npx vitest run` sweep (vite.config.js's `include`
// only matches src/**/*.test.{js,ts}) since this one needs a running RTDB
// emulator and every other test in this repo deliberately does not.
export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/security-rules.emulator.test.js"],
  },
});
