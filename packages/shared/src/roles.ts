export const ROLES = ["owner", "admin", "analyst", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "crm:read",
  "crm:write",
  "crm:delete",
  "research:run",
  "outreach:draft",
  "outreach:approve",
  "automation:manage",
  "automation:approve",
  "newsletter:approve",
  "integrations:manage",
  "members:manage",
  "audit:read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((p) => p !== "members:manage"),
  analyst: ["crm:read", "crm:write", "research:run", "outreach:draft"],
  viewer: ["crm:read"],
};

export function roleHas(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
