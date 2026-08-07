/**
 * Role-based capabilities. Pure and dependency-free so the whole matrix is
 * unit-testable — see tests/unit/permissions.test.ts. Checked in the service
 * layer, not only in the UI.
 */

export const ROLES = ["viewer", "editor", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export const CAPABILITIES = [
  "brand:read",
  "brand:write",
  "brand:delete",
  "source:upload",
  "source:delete",
  "evidence:review",
  "evidence:edit",
  "segment:generate",
  "persona:generate",
  "persona:approve",
  "prompt:generate",
  "prompt:approve",
  "profound:configure",
  "profound:retrieve_results",
  "content:generate",
  "content:approve",
  "export:read",
  "integration:manage",
  "member:manage",
  "evaluation:run",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Minimum role required for each capability. */
const REQUIRED_ROLE: Record<Capability, Role> = {
  "brand:read": "viewer",
  "brand:write": "editor",
  "brand:delete": "owner",
  "source:upload": "editor",
  "source:delete": "admin",
  "evidence:review": "editor",
  "evidence:edit": "editor",
  "segment:generate": "editor",
  "persona:generate": "editor",
  "persona:approve": "editor",
  "prompt:generate": "editor",
  "prompt:approve": "editor",
  "profound:configure": "admin",
  "profound:retrieve_results": "editor",
  "content:generate": "editor",
  "content:approve": "editor",
  "export:read": "viewer",
  "integration:manage": "admin",
  "member:manage": "owner",
  "evaluation:run": "editor",
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[REQUIRED_ROLE[capability]];
}

export function requiredRoleFor(capability: Capability): Role {
  return REQUIRED_ROLE[capability];
}

export function capabilitiesFor(role: Role): Capability[] {
  return CAPABILITIES.filter((capability) => can(role, capability));
}

export function atLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function roleLabel(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
