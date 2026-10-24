import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Testes *.int.test.ts batem no Postgres do compose (schema ijcrm_test);
    // rodam em série para não disputar as tabelas.
    fileParallelism: false,
    env: { TZ: "UTC" },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
