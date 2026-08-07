import "server-only";
import { z } from "zod";
import { config as loadDotenv } from "./dotenv";

loadDotenv();

const vendorMode = z.enum(["mock", "live"]).default("mock");

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const intFrom = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      const n = v === undefined || v === "" ? NaN : Number(v);
      return Number.isFinite(n) ? n : fallback;
    });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3100"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  TEST_DATABASE_URL: z.string().optional(),
  DATABASE_POOL_MAX: intFrom(10),

  APP_ENCRYPTION_KEY: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  SESSION_TTL_DAYS: intFrom(30),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage-local"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: boolish,

  QUEUE_DRIVER: z.enum(["postgres"]).default("postgres"),
  QUEUE_POLL_INTERVAL_MS: intFrom(1000),
  QUEUE_CONCURRENCY: intFrom(4),

  OPENAI_MODE: vendorMode,
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL_ECONOMICAL: z.string().default("gpt-4.1-mini"),
  OPENAI_MODEL_REASONING: z.string().default("gpt-4.1"),
  OPENAI_MODEL_EMBEDDING: z.string().default("text-embedding-3-small"),
  OPENAI_EMBEDDING_DIMENSIONS: intFrom(1536),

  PROFOUND_MODE: vendorMode,
  PROFOUND_API_KEY: z.string().optional(),
  PROFOUND_BASE_URL: z.string().default("https://api.tryprofound.com"),

  SPARKTORO_MODE: vendorMode,
  SPARKTORO_API_KEY: z.string().optional(),
  SPARKTORO_BASE_URL: z.string().default("https://api.sparktoro.com"),

  DATAFORSEO_MODE: vendorMode,
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  DATAFORSEO_BASE_URL: z.string().default("https://api.dataforseo.com"),

  MAX_UPLOAD_BYTES: intFrom(26_214_400),
  CRAWL_MAX_PAGES: intFrom(50),
  CRAWL_MAX_BYTES_PER_PAGE: intFrom(2_097_152),
  CRAWL_REQUESTS_PER_SECOND: intFrom(1),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

const isTest = raw.NODE_ENV === "test" || process.env.VITEST === "true";

/**
 * A development fallback key so the app boots with an empty .env. Production
 * refuses to start without a real key — see the assertion below.
 */
const DEV_KEY_FALLBACK = "ZGV2LW9ubHktaW5zZWN1cmUta2V5LWRvLW5vdC11c2UtMDE=";

if (raw.NODE_ENV === "production") {
  if (!raw.APP_ENCRYPTION_KEY) {
    throw new Error("APP_ENCRYPTION_KEY is required in production (openssl rand -base64 32)");
  }
  if (!raw.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production (openssl rand -base64 32)");
  }
}

export const env = {
  ...raw,
  DATABASE_URL: isTest && raw.TEST_DATABASE_URL ? raw.TEST_DATABASE_URL : raw.DATABASE_URL,
  APP_ENCRYPTION_KEY: raw.APP_ENCRYPTION_KEY || DEV_KEY_FALLBACK,
  SESSION_SECRET: raw.SESSION_SECRET || DEV_KEY_FALLBACK,
  isProduction: raw.NODE_ENV === "production",
  isTest,
  /** True when the encryption key is the insecure development fallback. */
  usingFallbackEncryptionKey: !raw.APP_ENCRYPTION_KEY,
} as const;

export type Env = typeof env;
