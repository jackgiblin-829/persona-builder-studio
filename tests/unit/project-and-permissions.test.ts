import { describe, expect, it } from "vitest";
import { can } from "@/lib/auth/rbac";
import { projectInputSchema, proposeAudienceDescription } from "@/services/projects";

describe("project contract", () => {
  it("normalizes the five-field project input and proposes an audience", () => {
    const input = projectInputSchema.parse({
      name: "Enterprise evaluators",
      canonicalDomain: "https://www.Example.com/pricing",
      description: "A workflow platform for enterprise operations teams.",
      primaryMarket: "UK",
      languageLocale: "en-GB",
    });
    expect(input.canonicalDomain).toBe("example.com");
    expect(proposeAudienceDescription(input)).toContain("the United Kingdom");
  });

  it("keeps viewers read-only while allowing export", () => {
    expect(can("viewer", "project:read")).toBe(true);
    expect(can("viewer", "export:read")).toBe(true);
    expect(can("viewer", "source:upload")).toBe(false);
    expect(can("editor", "source:upload")).toBe(true);
    expect(can("editor", "persona:edit")).toBe(true);
    expect(can("editor", "prompt:generate")).toBe(true);
  });
});
