import { defineConfig } from "vitest/config";

// A Worker's clock is UTC; the code relies on it (see src/time.js), so tests
// run the same way whatever zone the machine is in.
process.env.TZ = "UTC";

export default defineConfig({ test: { include: ["test/**/*.test.js"], pool: "forks" } });
