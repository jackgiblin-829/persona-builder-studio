import type { Config } from "drizzle-kit";
import { config as loadEnv } from "./src/lib/dotenv";

loadEnv();

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/persona_builder_studio",
  },
  strict: true,
  verbose: true,
} satisfies Config;
