export function resolveDatabaseUrl(testMode: boolean) {
  const mainUrl = process.env.DATABASE_URL;
  const testUrl = process.env.TEST_DATABASE_URL;
  if (testMode) {
    if (!testUrl) {
      throw new Error("TEST_DATABASE_URL must be set for every --test database command.");
    }
    if (mainUrl && normalizedDatabaseUrl(testUrl) === normalizedDatabaseUrl(mainUrl)) {
      throw new Error("TEST_DATABASE_URL must not point to the configured application database.");
    }
    return testUrl;
  }
  if (!mainUrl) throw new Error("DATABASE_URL is not set");
  return mainUrl;
}

function normalizedDatabaseUrl(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.hostname}:${url.port || "5432"}${url.pathname}`;
}
