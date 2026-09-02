/* eslint-disable no-console */
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES, PERMISSIONS } from '../src/common/permissions';

const prisma = new PrismaClient();
const ORG_CODE = 'SCI-RW';

/**
 * Production-safe RBAC synchronization.
 *
 * Unlike prisma/seed.ts, this script changes only the permission catalogue,
 * system roles, and their role-permission grants. It does not create users,
 * branches, templates, or sample data.
 */
async function main(): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { code: ORG_CODE },
    select: { id: true, code: true },
  });

  if (!organization) {
    throw new Error(`Organization ${ORG_CODE} was not found. Run the initial seed once before permission synchronization.`);
  }

  // Keep the permission catalogue aligned with the application source.
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: {
        category: permission.category,
        description: permission.description,
      },
      create: {
        code: permission.code,
        category: permission.category,
        description: permission.description,
      },
    });
  }

  const permissionByCode = new Map(
    (await prisma.permission.findMany({
      select: { id: true, code: true },
    })).map((permission) => [permission.code, permission.id]),
  );

  for (const definition of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: definition.code,
        },
      },
      update: {
        name: definition.name,
        description: definition.description,
      },
      create: {
        organizationId: organization.id,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
      select: { id: true, code: true },
    });

    const permissionIds = definition.permissions.map((code) => {
      const id = permissionByCode.get(code);
      if (!id) {
        throw new Error(`Permission ${code} is missing from the permission catalogue.`);
      }
      return id;
    });

    // Synchronize each system role atomically so a deployment never leaves a
    // role half-populated if the process fails between delete and create.
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId: role.id,
          permissionId,
        })),
        skipDuplicates: true,
      });
    });

    console.log(`  ${role.code}: ${permissionIds.length} permissions synchronized`);
  }

  console.log(`RBAC synchronization complete for ${organization.code}.`);
}

main()
  .catch((error: unknown) => {
    console.error('Permission synchronization failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
