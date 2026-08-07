import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    conditions: ["react-server", "node", "import", "default"],
    alias: {
      "@": resolve(__dirname, "src"),
      "@fixtures": resolve(__dirname, "fixtures"),
      "server-only": resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
