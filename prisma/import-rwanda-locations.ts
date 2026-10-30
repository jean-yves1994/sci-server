/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import locations from './data/rwanda-locations.json';

const prisma = new PrismaClient();

async function main() {
  const rows = locations as Array<{ code: string; name: string; level: number; parentCode: string | null }>;
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    await prisma.rwandaLocation.createMany({ data: rows.slice(i, i + batchSize), skipDuplicates: true });
  }
  const count = await prisma.rwandaLocation.count();
  console.log(`Imported/verified ${count} Rwanda location records (province, district, sector, cell only).`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
