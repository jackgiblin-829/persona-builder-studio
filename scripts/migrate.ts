import { config as loadEnv } from "../src/lib/dotenv";
loadEnv();

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

/**
 * Applies drizzle-generated SQL migrations in order, tracked in
 * `__pes_migrations`. Runs `CREATE EXTENSION vector` first because the schema
 * depends on it. Idempotent: already-applied files are skipped.
 */
async function main() {
  const url = process.argv.includes("--test")
    ? (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)
    : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const target = new URL(url).pathname.replace(/^\//, "");

  try {
    await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS __pes_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = resolve(process.cwd(), "drizzle");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM __pes_migrations`).map((r) => r.name),
    );

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = readFileSync(resolve(dir, file), "utf8");
      // drizzle separates statements with this marker
      const statements = body
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);
      await sql.begin(async (tx) => {
        for (const statement of statements) await tx.unsafe(statement);
        await tx`INSERT INTO __pes_migrations (name) VALUES (${file})`;
      });
      console.log(`applied ${file}`);
      count++;
    }

    console.log(
      count === 0 ? `${target}: already up to date` : `${target}: applied ${count} migration(s)`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
