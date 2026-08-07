import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

/**
 * Minimal .env loader. Values already present in process.env win (so CI and
 * shell exports override the file). Within the file, later lines win.
 * Deliberately dependency-free: this runs before anything else, including in
 * drizzle-kit config where the Next.js env loader is not available.
 */
export function config(file = ".env"): void {
  if (loaded) return;
  loaded = true;
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;

  const parsed: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}
