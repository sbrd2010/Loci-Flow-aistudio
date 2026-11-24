import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  // The date calendar is loaded lazily; pre-bundle its library so the dev
  // server doesn't discover it mid-session and reload every open page
  // (that reload made a parallel e2e flaky on a cold cache, #668).
  optimizeDeps: {
    include: ["@daypicker/react"]
  },
  build: {
    minify: "terser"
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,ts}"]
  }
});
