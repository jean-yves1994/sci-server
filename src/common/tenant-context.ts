import { BranchScope } from '@prisma/client';

/** The caller's security context, rebuilt from the database on every request. */
export interface TenantContext {
  userId: string;
  organizationId: string;
  primaryBranchId: string | null;
  accessibleBranchIds: string[];
  branchScope: BranchScope;
  permissions: ReadonlySet<string>;
  roles: string[];
  sessionId: string;
}

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
}

/**
 * The mandatory WHERE fragment for any tenant-scoped query.
 *
 * Every read of business data goes through this. Centralising it means a new
 * endpoint cannot leak another institution's data by forgetting a filter —
 * the most common multi-tenancy failure there is.
 */
export function buildTenantScope(user: TenantContext): {
  organizationId: string;
  branchId?: { in: string[] };
} {
  if (user.branchScope === 'ALL_BRANCHES') return { organizationId: user.organizationId };
  return { organizationId: user.organizationId, branchId: { in: user.accessibleBranchIds } };
}

export function canAccessBranch(user: TenantContext, branchId: string | null): boolean {
  if (user.branchScope === 'ALL_BRANCHES') return true;
  if (!branchId) return false;
  return user.accessibleBranchIds.includes(branchId);
}

export function hasPermission(user: TenantContext, permission: string): boolean {
  return user.permissions.has(permission);
}
