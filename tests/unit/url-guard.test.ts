import { describe, expect, it } from "vitest";
import {
  assertUrlIsSafe,
  canonicalizeUrl,
  hostIsAllowed,
  isAllowedByRobots,
  isBlockedAddress,
} from "@/lib/url-guard";
import { UnsafeUrlError } from "@/lib/errors";

const ALLOWLIST = ["northwind-analytics.example"];
const publicResolver = async () => ["93.184.216.34"];

describe("private address detection", () => {
  it("blocks loopback, private and link-local ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1", // IPv4-mapped loopback
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows genuine public addresses", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
    expect(isBlockedAddress("172.32.0.1")).toBe(false); // just outside the private block
  });

  it("blocks anything that is not a valid IP", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });
});

describe("allowlist matching", () => {
  it("matches the exact domain and its subdomains", () => {
    expect(hostIsAllowed("northwind-analytics.example", ALLOWLIST)).toBe(true);
    expect(hostIsAllowed("docs.northwind-analytics.example", ALLOWLIST)).toBe(true);
  });

  it("does not match a lookalike or suffix-attack domain", () => {
    expect(hostIsAllowed("northwind-analytics.example.evil.test", ALLOWLIST)).toBe(false);
    expect(hostIsAllowed("evilnorthwind-analytics.example", ALLOWLIST)).toBe(false);
    expect(hostIsAllowed("other.example", ALLOWLIST)).toBe(false);
  });
});

describe("assertUrlIsSafe", () => {
  it("accepts an allowlisted host that resolves publicly", async () => {
    const result = await assertUrlIsSafe(
      "https://northwind-analytics.example/pricing?utm_source=x",
      ALLOWLIST,
      { resolver: publicResolver },
    );
    expect(result.canonical).toBe("https://northwind-analytics.example/pricing");
  });

  it("rejects non-http schemes", async () => {
    await expect(assertUrlIsSafe("file:///etc/passwd", ALLOWLIST)).rejects.toThrow(UnsafeUrlError);
    await expect(assertUrlIsSafe("gopher://x.example/", ALLOWLIST)).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects a host outside the allowlist", async () => {
    await expect(
      assertUrlIsSafe("https://evil.example/", ALLOWLIST, { resolver: publicResolver }),
    ).rejects.toThrow(/not in this brand's approved crawl domains/);
  });

  it("rejects an allowlisted host that resolves to a private address (DNS rebinding)", async () => {
    await expect(
      assertUrlIsSafe("https://northwind-analytics.example/", ALLOWLIST, {
        resolver: async () => ["127.0.0.1"],
      }),
    ).rejects.toThrow(/private or reserved range/);
  });

  it("rejects when any one of several answers is private", async () => {
    await expect(
      assertUrlIsSafe("https://northwind-analytics.example/", ALLOWLIST, {
        resolver: async () => ["93.184.216.34", "169.254.169.254"],
      }),
    ).rejects.toThrow(/private or reserved range/);
  });

  it("rejects the cloud metadata endpoint by literal IP", async () => {
    await expect(
      assertUrlIsSafe("http://169.254.169.254/latest/meta-data/", ["169.254.169.254"]),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it("rejects URLs carrying credentials", async () => {
    await expect(
      assertUrlIsSafe("https://user:pass@northwind-analytics.example/", ALLOWLIST, {
        resolver: publicResolver,
      }),
    ).rejects.toThrow(/embedded credentials/);
  });

  it("rejects when the brand has no allowlist configured", async () => {
    await expect(assertUrlIsSafe("https://northwind-analytics.example/", [])).rejects.toThrow(
      /no approved crawl domains/,
    );
  });

  it("rejects an unresolvable host", async () => {
    await expect(
      assertUrlIsSafe("https://northwind-analytics.example/", ALLOWLIST, {
        resolver: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toThrow(/could not resolve/);
  });
});

describe("canonicalisation", () => {
  it("removes fragments, tracking parameters, default ports and trailing slashes", () => {
    expect(
      canonicalizeUrl("https://Northwind-Analytics.example:443/pricing/?utm_source=x&a=1#top"),
    ).toBe("https://northwind-analytics.example/pricing?a=1");
  });

  it("sorts query parameters so equivalent URLs collapse", () => {
    expect(canonicalizeUrl("https://a.example/p?b=2&a=1")).toBe(
      canonicalizeUrl("https://a.example/p?a=1&b=2"),
    );
  });
});

describe("robots.txt", () => {
  const robots = `User-agent: *
Disallow: /admin
Disallow: /private
Allow: /private/public-page

User-agent: BadBot
Disallow: /`;

  it("allows paths that are not disallowed", () => {
    expect(isAllowedByRobots(robots, "/pricing")).toBe(true);
  });

  it("blocks disallowed paths", () => {
    expect(isAllowedByRobots(robots, "/admin/settings")).toBe(false);
  });

  it("lets a longer Allow rule override a shorter Disallow", () => {
    expect(isAllowedByRobots(robots, "/private/public-page")).toBe(true);
    expect(isAllowedByRobots(robots, "/private/secret")).toBe(false);
  });

  it("applies an agent-specific group when one matches", () => {
    expect(isAllowedByRobots(robots, "/pricing", "BadBot")).toBe(false);
  });

  it("allows everything when robots.txt is empty", () => {
    expect(isAllowedByRobots("", "/anything")).toBe(true);
  });

  it("ignores comments", () => {
    expect(
      isAllowedByRobots("User-agent: *\n# Disallow: /pricing\nDisallow: /admin", "/pricing"),
    ).toBe(true);
  });
});
