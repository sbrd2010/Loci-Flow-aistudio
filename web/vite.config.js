import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000
  },
  build: {
    minify: "terser"
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{js,ts}"]
  }
});
