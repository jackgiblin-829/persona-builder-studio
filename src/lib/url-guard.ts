import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { UnsafeUrlError } from "./errors";

/**
 * SSRF protection for URL ingestion (§34).
 *
 * This is a bounded, allowlisted brand-page fetcher — not a general-purpose
 * crawler. Every check runs again on every redirect hop.
 */

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/** Ranges that must never be reachable from user-supplied input. */
function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a = 0, b = 0] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(normalized)) return true; // unique local fc00::/7
  // IPv4-mapped (::ffff:127.0.0.1) must be checked as IPv4.
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

/** Exact host match or a subdomain of an allowed domain. */
export function hostIsAllowed(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowlist.some((raw) => {
    const domain = raw
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\.$/, "");
    return host === domain || host.endsWith(`.${domain}`);
  });
}

/** Strips tracking parameters, fragments and default ports. */
export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  const drop = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
    "mc_cid",
    "mc_eid",
    "ref",
  ];
  for (const key of drop) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

export type UrlGuardResult = {
  url: URL;
  canonical: string;
  resolvedAddresses: string[];
};

/**
 * Validates a URL before any fetch. Throws `UnsafeUrlError` with a specific
 * reason — the reason is shown to the user so a rejected URL is explainable.
 */
export async function assertUrlIsSafe(
  rawUrl: string,
  allowlist: string[],
  options: { resolver?: (host: string) => Promise<string[]> } = {},
): Promise<UrlGuardResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("not a valid absolute URL");
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new UnsafeUrlError(`scheme "${url.protocol}" is not allowed (http and https only)`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with embedded credentials are not allowed");
  }
  if (allowlist.length === 0) {
    throw new UnsafeUrlError("this brand has no approved crawl domains configured");
  }
  if (!hostIsAllowed(url.hostname, allowlist)) {
    throw new UnsafeUrlError(
      `host "${url.hostname}" is not in this brand's approved crawl domains`,
    );
  }

  // A literal IP host bypasses DNS entirely, so check it directly.
  if (isIP(url.hostname)) {
    if (isBlockedAddress(url.hostname)) {
      throw new UnsafeUrlError(`address ${url.hostname} is in a private or reserved range`);
    }
    return { url, canonical: canonicalizeUrl(url.toString()), resolvedAddresses: [url.hostname] };
  }

  const resolve = options.resolver ?? defaultResolver;
  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw new UnsafeUrlError(`could not resolve host "${url.hostname}"`);
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`host "${url.hostname}" resolved to no addresses`);
  }
  // Every resolved address must be public — one private answer is enough to
  // make the request unsafe (DNS rebinding).
  for (const address of addresses) {
    if (isBlockedAddress(address)) {
      throw new UnsafeUrlError(
        `host "${url.hostname}" resolves to ${address}, which is in a private or reserved range`,
      );
    }
  }

  return { url, canonical: canonicalizeUrl(url.toString()), resolvedAddresses: addresses };
}

async function defaultResolver(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true });
  return results.map((r) => r.address);
}

/** Minimal robots.txt evaluation for our own user agent and `*`. */
export function isAllowedByRobots(robotsTxt: string, path: string, userAgent = "*"): boolean {
  const lines = robotsTxt.split("\n").map((line) => line.split("#")[0]!.trim());
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const line of lines) {
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (!key) continue;

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      if (!current) continue;
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === "allow", path: value });
      else if (key === "disallow") current.rules.push({ allow: true, path: "/" });
    }
  }

  const agent = userAgent.toLowerCase();
  const group =
    groups.find((g) => g.agents.includes(agent)) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;

  // Longest matching rule wins; Allow wins ties (standard behaviour).
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of group.rules) {
    if (!path.startsWith(rule.path)) continue;
    if (
      !best ||
      rule.path.length > best.length ||
      (rule.path.length === best.length && rule.allow)
    ) {
      best = { allow: rule.allow, length: rule.path.length };
    }
  }
  return best ? best.allow : true;
}
