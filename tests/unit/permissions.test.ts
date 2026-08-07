import { describe, expect, it } from "vitest";
import {
  CAPABILITIES,
  ROLES,
  atLeast,
  can,
  capabilitiesFor,
  requiredRoleFor,
} from "@/lib/auth/rbac";
import { orgContextFromSession, requireCapability, hasCapability } from "@/lib/auth/context";
import { ForbiddenError } from "@/lib/errors";
import type { AuthSession } from "@/lib/auth/session";

describe("role capability matrix", () => {
  it("gives every capability to an owner", () => {
    expect(capabilitiesFor("owner")).toHaveLength(CAPABILITIES.length);
  });

  it("gives a viewer read-only capabilities", () => {
    const viewerCaps = capabilitiesFor("viewer");
    expect(viewerCaps).toEqual(["brand:read", "export:read"]);
  });

  it("is monotonic — a higher role never loses a capability", () => {
    for (const capability of CAPABILITIES) {
      let seenAllowed = false;
      for (const role of ROLES) {
        const allowed = can(role, capability);
        if (seenAllowed) {
          expect(allowed, `${role} lost ${capability}`).toBe(true);
        }
        if (allowed) seenAllowed = true;
      }
    }
  });

  it("reserves Profound configuration (category mapping, reconciliation) for admin and above", () => {
    expect(can("viewer", "profound:configure")).toBe(false);
    expect(can("editor", "profound:configure")).toBe(false);
    expect(can("admin", "profound:configure")).toBe(true);
    expect(can("owner", "profound:configure")).toBe(true);
    expect(requiredRoleFor("profound:configure")).toBe("admin");
  });

  it("reserves credential management for admin and above", () => {
    expect(can("editor", "integration:manage")).toBe(false);
    expect(can("admin", "integration:manage")).toBe(true);
  });

  it("reserves source deletion for admin and above", () => {
    expect(can("editor", "source:delete")).toBe(false);
    expect(can("admin", "source:delete")).toBe(true);
  });

  it("reserves member management and brand deletion for owner", () => {
    expect(can("admin", "member:manage")).toBe(false);
    expect(can("owner", "member:manage")).toBe(true);
    expect(can("admin", "brand:delete")).toBe(false);
    expect(can("owner", "brand:delete")).toBe(true);
  });

  it("ranks roles correctly", () => {
    expect(atLeast("admin", "editor")).toBe(true);
    expect(atLeast("editor", "admin")).toBe(false);
    expect(atLeast("owner", "owner")).toBe(true);
  });
});

describe("requireCapability", () => {
  const ctx = {
    userId: "usr_1",
    userName: "Test",
    userEmail: "t@test.example",
    organizationId: "org_1",
    role: "editor" as const,
  };

  it("passes when the role allows it", () => {
    expect(() => requireCapability(ctx, "persona:approve")).not.toThrow();
  });

  it("throws ForbiddenError when it does not", () => {
    expect(() => requireCapability(ctx, "profound:configure")).toThrow(ForbiddenError);
  });

  it("names the role and capability in the message so the UI can explain it", () => {
    try {
      requireCapability(ctx, "profound:configure");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("editor");
      expect((error as Error).message).toContain("profound:configure");
    }
  });

  it("hasCapability mirrors requireCapability without throwing", () => {
    expect(hasCapability(ctx, "persona:approve")).toBe(true);
    expect(hasCapability(ctx, "profound:configure")).toBe(false);
  });
});

describe("organization scoping from a session", () => {
  const session: AuthSession = {
    sessionId: "ses_1",
    user: { id: "usr_1", email: "t@test.example", name: "Test" },
    memberships: [
      { organizationId: "org_a", organizationName: "A", organizationSlug: "a", role: "admin" },
    ],
  };

  it("resolves a context for an organization the user belongs to", () => {
    const ctx = orgContextFromSession(session, "org_a");
    expect(ctx.organizationId).toBe("org_a");
    expect(ctx.role).toBe("admin");
  });

  it("refuses an organization the user does not belong to", () => {
    expect(() => orgContextFromSession(session, "org_b")).toThrow(ForbiddenError);
  });
});
