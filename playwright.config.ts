import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "./src/lib/dotenv";
import { resolveDatabaseUrl } from "./scripts/database-url";

loadEnv();

const PORT = Number(process.env.E2E_PORT ?? 3111);
const E2E_DATABASE_URL = resolveDatabaseUrl(true);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      name: "app",
      command: `npm run build && npx next start -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/sign-in`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: { NODE_ENV: "production", DATABASE_URL: E2E_DATABASE_URL },
    },
    {
      name: "worker",
      command: "npm run worker",
      wait: { stdout: /worker starting/ },
      stdout: "pipe",
      timeout: 60_000,
      gracefulShutdown: { signal: "SIGTERM", timeout: 3_000 },
      env: { NODE_ENV: "test", DATABASE_URL: E2E_DATABASE_URL },
    },
  ],
});
