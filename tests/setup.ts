import { config as loadEnv } from "../src/lib/dotenv";

// Point every test at the test database before any module reads env.
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.VITEST = "true";
loadEnv();

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Deterministic vendor behaviour regardless of the developer's local .env.
process.env.OPENAI_MODE = "mock";
process.env.PROFOUND_MODE = "mock";
process.env.SPARKTORO_MODE = "mock";
process.env.DATAFORSEO_MODE = "mock";
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = "./storage-local/test";
process.env.LOG_LEVEL = "silent";
