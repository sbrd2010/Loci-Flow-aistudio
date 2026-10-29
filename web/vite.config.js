import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { firebaseCloudConfig } from "./src/utils/firebaseTarget.js";

export default defineConfig(({ command, mode }) => {
  if (command === "build") firebaseCloudConfig(loadEnv(mode, process.cwd(), "VITE_"));
  return {
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
  };
});
