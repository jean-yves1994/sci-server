import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES, PERMISSIONS } from '../src/common/permissions';

const prisma = new PrismaClient();

/**
 * Synchronize the application's permission catalogue and system role grants.
 *
 * This is intentionally separate from prisma/seed.ts: deployment should not
 * recreate demo/reference users or other seed data just to keep RBAC current.
 * The operation is idempotent and only changes permission/role definitions.
 */
async function main() {
  for (const permission of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key: permission },
      update: {},
      create: { key: permission },
    });
  }

  for (const definition of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { key: definition.key },
      update: {
        name: definition.name,
        description: definition.description,
      },
      create: {
        key: definition.key,
        name: definition.name,
        description: definition.description,
      },
    });

    const permissionRecords = await prisma.permission.findMany({
      where: { key: { in: definition.permissions } },
      select: { id: true, key: true },
    });

    const found = new Set(permissionRecords.map((permission) => permission.key));
    const missing = definition.permissions.filter((permission) => !found.has(permission));
    if (missing.length > 0) {
      throw new Error(`Missing permission catalogue entries for ${definition.key}: ${missing.join(', ')}`);
    }

    const desiredPermissionIds = new Set(permissionRecords.map((permission) => permission.id));

    const existingGrants = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { id: true, permissionId: true },
    });

    const staleIds = existingGrants
      .filter((grant) => !desiredPermissionIds.has(grant.permissionId))
      .map((grant) => grant.id);

    if (staleIds.length > 0) {
      await prisma.rolePermission.deleteMany({ where: { id: { in: staleIds } } });
    }

    const existingPermissionIds = new Set(existingGrants.map((grant) => grant.permissionId));
    const missingGrants = permissionRecords
      .filter((permission) => !existingPermissionIds.has(permission.id))
      .map((permission) => ({ roleId: role.id, permissionId: permission.id }));

    if (missingGrants.length > 0) {
      await prisma.rolePermission.createMany({
        data: missingGrants,
        skipDuplicates: true,
      });
    }

    console.log(`Synchronized role ${definition.key}: ${definition.permissions.length} permissions`);
  }
}

main()
  .catch((error) => {
    console.error('Permission synchronization failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
