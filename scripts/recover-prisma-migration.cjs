const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const MIGRATION = '20260912000000_client_inspection_workflow';

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1',
      MIGRATION,
    );

    if (rows.length === 0) {
      console.log(`[migration-recovery] ${MIGRATION} is not recorded in _prisma_migrations; nothing to resolve.`);
      return;
    }

    const row = rows[0];
    if (row.finished_at || row.rolled_back_at) {
      console.log(`[migration-recovery] ${MIGRATION} is already resolved; nothing to do.`);
      return;
    }

    console.log(`[migration-recovery] Resolving failed migration: ${MIGRATION}`);
    execFileSync('npx', ['prisma', 'migrate', 'resolve', '--rolled-back', MIGRATION], {
      stdio: 'inherit',
      env: process.env,
    });
    console.log(`[migration-recovery] ${MIGRATION} marked rolled back successfully.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[migration-recovery] Failed:', error?.message || error);
  process.exit(1);
});
