import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

declare global {
  var __pesSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  return postgres(env.DATABASE_URL, {
    max: env.isTest ? 5 : env.DATABASE_POOL_MAX,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
  });
}

// Reuse across hot reloads in development so we do not exhaust connections.
export const sql = globalThis.__pesSql ?? createClient();
if (!env.isProduction) globalThis.__pesSql = sql;

export const db = drizzle(sql, { schema });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run a query: the pool or an open transaction. */
export type Executor = Database | Transaction;

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
  globalThis.__pesSql = undefined;
}
