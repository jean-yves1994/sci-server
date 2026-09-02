/**
 * The permission catalogue.
 *
 * One place, so seed, guards and both clients agree. A permission not listed
 * here does not exist, which turns a typo in @RequirePermissions into a visible
 * failure rather than a silent grant.
 */
export const PERMISSIONS = [
  { code: 'users.read', category: 'Users', description: 'View users' },
  { code: 'users.write', category: 'Users', description: 'Create and edit users' },
  { code: 'users.reset_password', category: 'Users', description: 'Reset another user password' },
  { code: 'roles.read', category: 'Roles', description: 'View roles and permissions' },
  { code: 'roles.write', category: 'Roles', description: 'Create and edit roles' },
  { code: 'branches.read', category: 'Branches', description: 'View branches' },
  { code: 'branches.write', category: 'Branches', description: 'Create and edit branches' },
  { code: 'properties.read', category: 'Properties', description: 'View properties' },
  { code: 'properties.write', category: 'Properties', description: 'Create and edit properties' },
  { code: 'inspections.read', category: 'Inspections', description: 'View inspections' },
  { code: 'inspections.write', category: 'Inspections', description: 'Fill in and submit inspections' },
  { code: 'inspections.create', category: 'Inspections', description: 'Raise new inspections' },
  { code: 'inspections.assign', category: 'Inspections', description: 'Assign and reassign inspectors' },
  { code: 'inspections.archive', category: 'Inspections', description: 'Archive completed inspections' },
  { code: 'reviews.read', category: 'Reviews', description: 'View the review queue' },
  { code: 'reviews.decide', category: 'Reviews', description: 'Approve, reject or return inspections' },
  { code: 'reports.read', category: 'Reports', description: 'View and download reports' },
  { code: 'reports.generate', category: 'Reports', description: 'Generate official reports' },
  { code: 'templates.read', category: 'Templates', description: 'View inspection templates' },
  { code: 'templates.write', category: 'Templates', description: 'Create and edit templates' },
  { code: 'audit.read', category: 'Audit', description: 'View the audit trail' },
  { code: 'analytics.read', category: 'Analytics', description: 'View dashboards and analytics' },
  { code: 'settings.write', category: 'Settings', description: 'Change system configuration' },
] as const;

export const ALL_PERMISSION_CODES: string[] = PERMISSIONS.map((p) => p.code);

/**
 * Default roles.
 *
 * The Inspector deliberately holds no reviews.* permission. An inspector who
 * could approve their own work would make the review stage decorative.
 */
export const DEFAULT_ROLES: Array<{
  code: string; name: string; description: string; permissions: string[];
}> = [
  {
    code: 'ADMINISTRATOR',
    name: 'Administrator',
    description: 'Full platform access, including user and template administration.',
    permissions: ALL_PERMISSION_CODES,
  },
  {
    code: 'REVIEWER',
    name: 'Reviewer',
    description: 'Reviews submitted inspections and decides on them.',
    permissions: [
      'users.read','branches.read','properties.read','properties.write',
      'inspections.read','inspections.create','inspections.assign',
      'reviews.read','reviews.decide','reports.read','reports.generate',
      'templates.read','analytics.read','audit.read',
    ],
  },
  {
    code: 'INSPECTOR',
    name: 'Inspector',
    description: 'Carries out field inspections and can register properties and raise inspections for their own fieldwork.',
    permissions: [
      'branches.read','properties.read','properties.write',
      'inspections.read','inspections.write','inspections.create',
      'reports.read','templates.read',
    ],
  },
];
