import { config as loadEnv } from "../src/lib/dotenv";
loadEnv();

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { resolveDatabaseUrl } from "./database-url";

/**
 * Applies drizzle-generated SQL migrations in order, tracked in
 * `__pes_migrations`. Idempotent: already-applied files are skipped.
 */
async function main() {
  const url = resolveDatabaseUrl(process.argv.includes("--test"));

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const target = new URL(url).pathname.replace(/^\//, "");

  try {
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

    let applied = new Set(
      (await sql<{ name: string }[]>`SELECT name FROM __pes_migrations`).map((r) => r.name),
    );

    // The project-first rework intentionally has no compatibility migration.
    // If this database carries any superseded migration name, reset the public
    // schema before applying the new single initial migration.
    const currentNames = new Set(files);
    if ([...applied].some((name) => !currentNames.has(name))) {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_PERSONA_STUDIO_RESET !== "true"
      ) {
        throw new Error(
          "The Persona Builder Studio rework requires a full database reset. Set ALLOW_PERSONA_STUDIO_RESET=true for this intentional production migration.",
        );
      }
      console.warn(
        `${target}: legacy migration history found; performing the intentional project-first reset`,
      );
      await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public`);
      await sql.unsafe(`
        CREATE TABLE __pes_migrations (
          name text PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      applied = new Set<string>();
    }

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
