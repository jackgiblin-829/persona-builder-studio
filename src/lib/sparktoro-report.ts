import { sha256 } from "./crypto";

export function sparkReportHash(
  audience: string,
  market: string,
  locale: string,
  mode: "mock" | "live",
) {
  return sha256(JSON.stringify({ audience: audience.trim().toLowerCase(), market, locale, mode }));
}
