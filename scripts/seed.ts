import { config as loadEnv } from "../src/lib/dotenv";
import { resolveDatabaseUrl } from "./database-url";
loadEnv();

async function main() {
  if (process.argv.includes("--test")) {
    process.env.DATABASE_URL = resolveDatabaseUrl(true);
  }
  const { runSeed } = await import("../src/seed/run");
  const summary = await runSeed({ fresh: !process.argv.includes("--keep") });
  console.log("\nSeed complete.\n");
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key.padEnd(28)} ${value}`);
  }
  console.log("\nSign in at http://localhost:3100/sign-in");
  console.log("  admin@example.com / demo-password-1   (owner)");
  console.log("  analyst@example.com / demo-password-2 (editor)");
  console.log("  viewer@example.com / demo-password-3  (viewer)\n");
  const { closeDb } = await import("../src/db/client");
  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
