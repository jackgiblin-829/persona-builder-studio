export const ROLES = ["viewer", "editor", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export const CAPABILITIES = [
  "project:read",
  "project:write",
  "project:delete",
  "source:upload",
  "source:delete",
  "persona:generate",
  "persona:edit",
  "prompt:generate",
  "export:read",
  "integration:manage",
  "member:manage",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const REQUIRED_ROLE: Record<Capability, Role> = {
  "project:read": "viewer",
  "project:write": "editor",
  "project:delete": "owner",
  "source:upload": "editor",
  "source:delete": "admin",
  "persona:generate": "editor",
  "persona:edit": "editor",
  "prompt:generate": "editor",
  "export:read": "viewer",
  "integration:manage": "admin",
  "member:manage": "owner",
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
