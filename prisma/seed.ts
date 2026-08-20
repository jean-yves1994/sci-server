/* eslint-disable no-console */
/**
 * Development seed.
 *
 * The explicit dotenv import on the first line matters. PrismaClient loads .env
 * by itself for DATABASE_URL, which makes it easy to assume the rest of .env is
 * loaded too — it is not. A seed reading process.env.SEED_ADMIN_PASSWORD without
 * this would find it undefined, create no administrator, and leave you at a
 * login screen reporting "incorrect password" for an account never created.
 *
 * This creates reference data (permissions, roles, divisions, template) and a
 * small number of working accounts. It creates no fabricated inspection
 * content: statistics on the dashboard should reflect real work, not seed noise.
 */
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { DEFAULT_ROLES, PERMISSIONS } from '../src/common/permissions';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const prisma = new PrismaClient();

/** Must stay identical to hashPassword in src/common/utils/password.util.ts. */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

const ORG_CODE = 'SCI-RW';

/** Rwanda's administrative hierarchy, as a small representative subset. */
const DIVISIONS: Array<{ name: string; districts: Array<{ name: string; sectors: string[] }> }> = [
  {
    name: 'Kigali City',
    districts: [
      { name: 'Nyarugenge', sectors: ['Nyamirambo', 'Kimisagara', 'Muhima'] },
      { name: 'Gasabo', sectors: ['Remera', 'Kimironko', 'Kacyiru'] },
      { name: 'Kicukiro', sectors: ['Kagarama', 'Niboye', 'Gatenga'] },
    ],
  },
  {
    name: 'Northern Province',
    districts: [{ name: 'Musanze', sectors: ['Muhoza', 'Cyuve'] }],
  },
  {
    name: 'Southern Province',
    districts: [{ name: 'Huye', sectors: ['Ngoma', 'Tumba'] }],
  },
];

const BRANCHES = [
  { code: 'KGL-001', name: 'Kigali Main Branch', district: 'Nyarugenge' },
  { code: 'KGL-002', name: 'Remera Branch', district: 'Gasabo' },
  { code: 'KGL-003', name: 'Kicukiro Branch', district: 'Kicukiro' },
  { code: 'MSZ-001', name: 'Musanze Branch', district: 'Musanze' },
  { code: 'HYE-001', name: 'Huye Branch', district: 'Huye' },
];

/**
 * The default inspection template.
 *
 * Assessment sections carry a rating; data sections carry fields. Because this
 * lives in the database rather than in the mobile binary, an administrator can
 * change what inspectors record without shipping a new app release.
 */
const TEMPLATE_SECTIONS = [
  {
    code: 'PROPERTY',
    name: 'Property information',
    isAssessment: false,
    sortOrder: 1,
    fields: [
      { code: 'PROPERTY_USE', label: 'Current use', type: 'SELECT', required: true,
        options: [
          { value: 'RESIDENTIAL', label: 'Residential' },
          { value: 'COMMERCIAL', label: 'Commercial' },
          { value: 'MIXED', label: 'Mixed use' },
          { value: 'INDUSTRIAL', label: 'Industrial' },
          { value: 'LAND', label: 'Vacant land' },
        ] },
      { code: 'PLOT_SIZE_SQM', label: 'Plot size (m²)', type: 'NUMBER', required: true,
        validation: { min: 1, max: 1_000_000 } },
      { code: 'BUILT_AREA_SQM', label: 'Built area (m²)', type: 'NUMBER', required: false,
        validation: { min: 0, max: 1_000_000 } },
      { code: 'YEAR_BUILT', label: 'Year built', type: 'NUMBER', required: false,
        validation: { min: 1800, max: 2100 } },
      { code: 'STOREYS', label: 'Number of storeys', type: 'NUMBER', required: false,
        validation: { min: 0, max: 200 } },
    ],
  },
  {
    code: 'ACCESS',
    name: 'Access and services',
    isAssessment: false,
    sortOrder: 2,
    fields: [
      { code: 'ROAD_TYPE', label: 'Access road surface', type: 'SELECT', required: true,
        options: [
          { value: 'TARMAC', label: 'Tarmac' },
          { value: 'MURRAM', label: 'Murram' },
          { value: 'EARTH', label: 'Earth track' },
          { value: 'NONE', label: 'No vehicle access' },
        ] },
      { code: 'HAS_ELECTRICITY', label: 'Connected to electricity', type: 'BOOLEAN', required: true },
      { code: 'HAS_WATER', label: 'Connected to piped water', type: 'BOOLEAN', required: true },
      { code: 'ACCESS_NOTES', label: 'Access notes', type: 'TEXTAREA', required: false,
        validation: { maxLength: 1000 } },
    ],
  },
  { code: 'FOUNDATION', name: 'Foundation', isAssessment: true, sortOrder: 3, fields: [] },
  { code: 'ROOF', name: 'Roof', isAssessment: true, sortOrder: 4, fields: [] },
  { code: 'WALLS', name: 'Walls', isAssessment: true, sortOrder: 5, fields: [] },
  { code: 'WINDOWS', name: 'Windows and doors', isAssessment: true, sortOrder: 6, fields: [] },
  { code: 'UTILITIES', name: 'Utilities', isAssessment: true, sortOrder: 7, fields: [] },
  { code: 'ACCESSIBILITY', name: 'Accessibility', isAssessment: true, sortOrder: 8, fields: [] },
  { code: 'SECURITY', name: 'Security', isAssessment: true, sortOrder: 9, fields: [] },
  { code: 'GENERAL', name: 'General condition', isAssessment: true, sortOrder: 10, fields: [] },
];

const PHOTO_RULES = [
  { category: 'FRONT_VIEW', minCount: 1, required: true, description: 'Front elevation' },
  { category: 'REAR_VIEW', minCount: 1, required: true, description: 'Rear elevation' },
  { category: 'INTERIOR', minCount: 2, required: true, description: 'Interior, at least two rooms' },
  { category: 'ROAD_ACCESS', minCount: 1, required: true, description: 'Access road' },
  { category: 'ROOF', minCount: 1, required: false, description: 'Roof condition' },
  { category: 'FOUNDATION', minCount: 1, required: false, description: 'Foundation' },
  { category: 'DOCUMENT', minCount: 1, required: false, description: 'Title deed' },
];

async function main(): Promise<void> {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@sci.rw').trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345678';

  if (adminPassword.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
  }

  console.log('');
  console.log('Seeding the SCI platform');
  console.log('========================');

  // --- Organization --------------------------------------------------------
  const organization = await prisma.organization.upsert({
    where: { code: ORG_CODE },
    update: {},
    create: {
      code: ORG_CODE,
      name: 'SCI Rwanda',
      legalName: 'Smart Collateral Inspection Rwanda Ltd',
      addressLine: 'KN 3 Ave, Nyarugenge, Kigali',
      phone: '+250 788 000 000',
      email: 'operations@sci.rw',
      status: 'ACTIVE',
    },
  });
  console.log(`  Organization: ${organization.name}`);

  // --- Permissions ---------------------------------------------------------
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { category: permission.category, description: permission.description },
      create: {
        code: permission.code,
        category: permission.category,
        description: permission.description,
      },
    });
  }
  console.log(`  Permissions: ${PERMISSIONS.length}`);

  const permissionByCode = new Map(
    (await prisma.permission.findMany()).map((p) => [p.code, p.id]),
  );

  // --- Roles ---------------------------------------------------------------
  for (const definition of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: definition.code } },
      update: { name: definition.name, description: definition.description },
      create: {
        organizationId: organization.id,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
    });

    // Re-applied from the definition each run, so editing DEFAULT_ROLES and
    // re-seeding actually changes what the role can do.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: definition.permissions
        .map((code) => permissionByCode.get(code))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });

    console.log(`  Role: ${definition.name.padEnd(14)} ${definition.permissions.length} permissions`);
  }

  const roleByCode = new Map(
    (await prisma.role.findMany({ where: { organizationId: organization.id } })).map((r) => [r.code, r.id]),
  );

  // --- Administrative divisions -------------------------------------------
  const districtByName = new Map<string, string>();

  for (const province of DIVISIONS) {
    const provinceRow = await prisma.administrativeDivision.findFirst({
      where: { organizationId: organization.id, level: 1, name: province.name },
    });

    const provinceId =
      provinceRow?.id ??
      (
        await prisma.administrativeDivision.create({
          data: { organizationId: organization.id, level: 1, name: province.name },
        })
      ).id;

    for (const district of province.districts) {
      const districtRow = await prisma.administrativeDivision.findFirst({
        where: { organizationId: organization.id, level: 2, name: district.name, parentId: provinceId },
      });

      const districtId =
        districtRow?.id ??
        (
          await prisma.administrativeDivision.create({
            data: {
              organizationId: organization.id,
              parentId: provinceId,
              level: 2,
              name: district.name,
            },
          })
        ).id;

      districtByName.set(district.name, districtId);

      for (const sector of district.sectors) {
        const exists = await prisma.administrativeDivision.findFirst({
          where: { organizationId: organization.id, level: 3, name: sector, parentId: districtId },
        });
        if (!exists) {
          await prisma.administrativeDivision.create({
            data: {
              organizationId: organization.id,
              parentId: districtId,
              level: 3,
              name: sector,
            },
          });
        }
      }
    }
  }
  console.log(`  Administrative divisions: ${DIVISIONS.length} provinces`);

  // --- Branches ------------------------------------------------------------
  for (const branch of BRANCHES) {
    await prisma.branch.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: branch.code } },
      update: { name: branch.name, divisionId: districtByName.get(branch.district) ?? null },
      create: {
        organizationId: organization.id,
        code: branch.code,
        name: branch.name,
        divisionId: districtByName.get(branch.district) ?? null,
        status: 'ACTIVE',
      },
    });
  }
  console.log(`  Branches: ${BRANCHES.length}`);

  const branches = await prisma.branch.findMany({
    where: { organizationId: organization.id },
    orderBy: { code: 'asc' },
  });
  const mainBranch = branches[0];

  // --- Template ------------------------------------------------------------
  const template = await prisma.inspectionTemplate.upsert({
    where: {
      organizationId_code_version: {
        organizationId: organization.id,
        code: 'STANDARD_PROPERTY',
        version: 1,
      },
    },
    update: { isDefault: true, status: 'ACTIVE' },
    create: {
      organizationId: organization.id,
      code: 'STANDARD_PROPERTY',
      name: 'Standard property inspection',
      description: 'Default template for residential and commercial collateral.',
      version: 1,
      isDefault: true,
      status: 'ACTIVE',
    },
  });

  for (const section of TEMPLATE_SECTIONS) {
    const sectionRow = await prisma.templateSection.upsert({
      where: { templateId_code: { templateId: template.id, code: section.code } },
      update: { name: section.name, isAssessment: section.isAssessment, sortOrder: section.sortOrder },
      create: {
        templateId: template.id,
        code: section.code,
        name: section.name,
        isAssessment: section.isAssessment,
        sortOrder: section.sortOrder,
      },
    });

    for (const [index, field] of section.fields.entries()) {
      await prisma.templateField.upsert({
        where: { sectionId_code: { sectionId: sectionRow.id, code: field.code } },
        update: {
          label: field.label,
          type: field.type as never,
          required: field.required,
          sortOrder: index + 1,
          options: (field as { options?: unknown }).options ?? undefined,
          validation: (field as { validation?: unknown }).validation ?? undefined,
        },
        create: {
          sectionId: sectionRow.id,
          code: field.code,
          label: field.label,
          type: field.type as never,
          required: field.required,
          sortOrder: index + 1,
          options: (field as { options?: unknown }).options ?? undefined,
          validation: (field as { validation?: unknown }).validation ?? undefined,
        },
      });
    }
  }

  for (const rule of PHOTO_RULES) {
    await prisma.templatePhotoRule.upsert({
      where: {
        templateId_category: { templateId: template.id, category: rule.category as never },
      },
      update: { minCount: rule.minCount, required: rule.required, description: rule.description },
      create: {
        templateId: template.id,
        category: rule.category as never,
        minCount: rule.minCount,
        required: rule.required,
        description: rule.description,
      },
    });
  }

  const assessmentCount = TEMPLATE_SECTIONS.filter((s) => s.isAssessment).length;
  console.log(
    `  Template: ${template.name} (${assessmentCount} assessment categories, ${PHOTO_RULES.length} photo rules)`,
  );

  // --- Users ---------------------------------------------------------------
  const demoPassword = 'Demo@12345678';

  const people = [
    {
      email: adminEmail, firstName: 'System', lastName: 'Administrator',
      role: 'ADMINISTRATOR', branchIndex: 0, scope: 'ALL_BRANCHES' as const,
      password: adminPassword,
    },
    {
      email: 'reviewer@sci.rw', firstName: 'Jane', lastName: 'Uwase',
      role: 'REVIEWER', branchIndex: 0, scope: 'ALL_BRANCHES' as const,
      password: demoPassword,
    },
    {
      email: 'inspector@sci.rw', firstName: 'John', lastName: 'Habimana',
      role: 'INSPECTOR', branchIndex: 0, scope: 'OWN_BRANCH' as const,
      password: demoPassword,
    },
    {
      email: 'inspector2@sci.rw', firstName: 'Claudine', lastName: 'Mukamana',
      role: 'INSPECTOR', branchIndex: 1, scope: 'OWN_BRANCH' as const,
      password: demoPassword,
    },
  ];

  for (const person of people) {
    const passwordHash = await hashPassword(person.password);
    const branch = branches[person.branchIndex] ?? mainBranch;

    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: {
        // Re-seeding restores a known password, which is what makes this a
        // reliable recovery path when a login stops working.
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
        deletedAt: null,
        branchScope: person.scope,
        branchId: branch.id,
      },
      create: {
        organizationId: organization.id,
        branchId: branch.id,
        email: person.email,
        passwordHash,
        firstName: person.firstName,
        lastName: person.lastName,
        status: 'ACTIVE',
        branchScope: person.scope,
        // Deliberately false: forcing a change on a demo account would block
        // the very first sign-in that proves the setup works.
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    const roleId = roleByCode.get(person.role);
    if (roleId) {
      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      await prisma.userRole.create({ data: { userId: user.id, roleId } });
    }

    console.log(`  User: ${person.email.padEnd(24)} ${person.role}`);
  }

  // --- Properties ----------------------------------------------------------
  // Real coordinates in Kigali, so proof-of-presence checks can be exercised
  // meaningfully rather than always returning UNVERIFIABLE.
  const properties = [
    {
      reference: 'PROP-2026-0001', propertyType: 'Residential house',
      addressLine: 'KG 11 Ave, Remera', district: 'Gasabo',
      latitude: -1.9536, longitude: 30.0928, branchIndex: 1,
    },
    {
      reference: 'PROP-2026-0002', propertyType: 'Commercial building',
      addressLine: 'KN 2 St, Nyamirambo', district: 'Nyarugenge',
      latitude: -1.9706, longitude: 30.0489, branchIndex: 0,
    },
    {
      reference: 'PROP-2026-0003', propertyType: 'Vacant land',
      addressLine: 'KK 15 Rd, Kagarama', district: 'Kicukiro',
      latitude: -1.9889, longitude: 30.1064, branchIndex: 2,
    },
  ];

  for (const property of properties) {
    await prisma.property.upsert({
      where: {
        organizationId_reference: {
          organizationId: organization.id,
          reference: property.reference,
        },
      },
      update: {},
      create: {
        organizationId: organization.id,
        branchId: branches[property.branchIndex].id,
        reference: property.reference,
        propertyType: property.propertyType,
        addressLine: property.addressLine,
        divisionId: districtByName.get(property.district) ?? null,
        latitude: property.latitude,
        longitude: property.longitude,
      },
    });
  }
  console.log(`  Properties: ${properties.length}`);

  console.log('');
  console.log('  No inspections were seeded. Create one through the web application so');
  console.log('  that every figure on the dashboard reflects real recorded work.');
  console.log('');
  console.log('Sign in at http://localhost:3000');
  console.log('');
  console.log(`  ${adminEmail.padEnd(24)} ${adminPassword.padEnd(16)} Administrator`);
  console.log(`  reviewer@sci.rw${' '.repeat(9)} ${demoPassword.padEnd(16)} Reviewer`);
  console.log(`  inspector@sci.rw${' '.repeat(8)} ${demoPassword.padEnd(16)} Inspector`);
  console.log('');
}

main()
  .catch((error: unknown) => {
    console.error('');
    console.error('Seed failed:', error instanceof Error ? error.message : error);
    console.error('');
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
