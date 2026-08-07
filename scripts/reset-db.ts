import { config as loadEnv } from "../src/lib/dotenv";
loadEnv();

import postgres from "postgres";

/** Drops and recreates the public schema. Refuses to run in production. */
async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:reset is disabled in production");
  }
  const url = process.argv.includes("--test")
    ? (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)
    : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log(`reset ${new URL(url).pathname.replace(/^\//, "")}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
