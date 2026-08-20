#!/usr/bin/env node
/**
 * Pre-deployment check for the SCI backend.
 *
 *   node preflight.mjs "C:\path\to\sci-platform\backend"
 *   node preflight.mjs               (run from inside backend/)
 *
 * Every check here corresponds to a failure that is either silent or
 * misleading when it happens on a deployment platform. Running this takes two
 * seconds; discovering the same problem after a push costs a build cycle, and
 * some of these do not surface until a user hits the endpoint.
 *
 * Exits non-zero if anything is BLOCKING.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TARGET = resolve(process.argv[2] ?? process.cwd());

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[90m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

let blocking = 0;
let warnings = 0;

const section = (m) => console.log(`\n${c.cyan}${c.bold}${m}${c.reset}`);
const pass = (m) => console.log(`  ${c.green}PASS${c.reset}   ${m}`);
const fail = (m, why) => {
  console.log(`  ${c.red}BLOCK${c.reset}  ${m}`);
  if (why) console.log(`         ${c.dim}${why}${c.reset}`);
  blocking += 1;
};
const warn = (m, why) => {
  console.log(`  ${c.yellow}WARN${c.reset}   ${m}`);
  if (why) console.log(`         ${c.dim}${why}${c.reset}`);
  warnings += 1;
};
const info = (m) => console.log(`  ${c.dim}····${c.reset}   ${c.dim}${m}${c.reset}`);

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

// ---------------------------------------------------------------------------
console.log(`${c.bold}SCI backend — pre-deployment check${c.reset}`);
console.log(`${c.dim}${TARGET}${c.reset}`);

// --- 1. structure -----------------------------------------------------------
section('1. Project structure');

const pkgRaw = read(join(TARGET, 'package.json'));
if (!pkgRaw) {
  fail('package.json not found', `Is ${TARGET} really the backend folder?`);
  console.log('\nCannot continue without package.json.\n');
  process.exit(1);
}

const pkg = JSON.parse(pkgRaw);
pass(`package.json (${pkg.name ?? 'unnamed'})`);

const schemaPath = join(TARGET, 'prisma', 'schema.prisma');
const schema = read(schemaPath);
if (schema) pass('prisma/schema.prisma');
else fail('prisma/schema.prisma not found');

// Platforms detect the entrypoint by convention; src/main.ts is expected.
const mainPath = join(TARGET, 'src', 'main.ts');
const main = read(mainPath);
if (main) pass('src/main.ts');
else fail('src/main.ts not found', 'Deployment platforms look for this entrypoint by name.');

// --- 2. migrations ----------------------------------------------------------
section('2. Database migrations');

const migrationsDir = join(TARGET, 'prisma', 'migrations');
let migrationCount = 0;

if (existsSync(migrationsDir)) {
  migrationCount = readdirSync(migrationsDir).filter((entry) => {
    try {
      return statSync(join(migrationsDir, entry)).isDirectory();
    } catch {
      return false;
    }
  }).length;
}

if (migrationCount > 0) {
  pass(`${migrationCount} migration(s) present`);
} else {
  // This is the one that fails silently. `prisma migrate deploy` with no
  // migration files reports success and applies nothing, so the service boots
  // against an empty schema and every query fails at runtime instead.
  fail(
    'no migration files — `prisma migrate deploy` will do nothing',
    'The local setup used `prisma db push`, which creates no migrations.\n' +
      '         Deploy would succeed against an EMPTY database, then every query\n' +
      '         fails with "table does not exist". Create one first:\n\n' +
      '           npx prisma migrate dev --name init\n',
  );
}

// --- 3. prisma schema config ------------------------------------------------
section('3. Prisma datasource');

if (schema) {
  const hasUrl = /url\s*=\s*env\("DATABASE_URL"\)/.test(schema);
  const hasDirect = /directUrl\s*=\s*env\("DIRECT_URL"\)/.test(schema);

  if (hasUrl) pass('datasource url reads DATABASE_URL');
  else fail('datasource url does not read env("DATABASE_URL")');

  if (hasDirect) {
    pass('datasource directUrl reads DIRECT_URL');
  } else {
    warn(
      'no directUrl in schema.prisma',
      'Required with a pooled Neon connection. PgBouncer in transaction mode\n' +
        '         cannot run migrations, so the CLI needs the direct URL:\n\n' +
        '           datasource db {\n' +
        '             provider  = "postgresql"\n' +
        '             url       = env("DATABASE_URL")\n' +
        '             directUrl = env("DIRECT_URL")\n' +
        '           }\n',
    );
  }
}

// --- 4. scripts -------------------------------------------------------------
section('4. npm scripts');

const scripts = pkg.scripts ?? {};
const need = {
  build: 'compiles the app',
  'start:prod': 'what the platform runs',
  'prisma:generate': 'generates the client',
  'prisma:deploy': 'applies migrations in production',
};

for (const [name, why] of Object.entries(need)) {
  if (scripts[name]) pass(`"${name}": ${scripts[name]}`);
  else warn(`missing script "${name}" — ${why}`);
}

if (scripts['prisma:deploy']?.includes('migrate dev')) {
  fail(
    '"prisma:deploy" runs `migrate dev`',
    'migrate dev is interactive and can reset data. Production must use\n' +
      '         `prisma migrate deploy`.',
  );
}

// --- 5. runtime behaviour ---------------------------------------------------
section('5. Runtime behaviour');

if (main) {
  // Platforms assign a port through the environment; a hard-coded port means
  // the health check never connects and the deploy is marked failed.
  const readsPort = /process\.env\.PORT/.test(main) ||
    /process\.env\.PORT/.test(read(join(TARGET, 'src', 'config', 'configuration.ts')) ?? '');

  if (readsPort) pass('listens on process.env.PORT');
  else {
    fail(
      'PORT is not read from the environment',
      'Railway and Render inject PORT. A fixed port means the health check\n' +
        '         never connects and the deploy is marked failed.',
    );
  }

  // Railway sends SIGTERM before replacing a container. Without shutdown hooks
  // in-flight requests are cut off on every deploy.
  if (/enableShutdownHooks/.test(main)) {
    pass('enableShutdownHooks() is called');
  } else {
    warn(
      'enableShutdownHooks() not called in main.ts',
      'Platforms send SIGTERM before replacing a container. Without this,\n' +
        '         in-flight requests are dropped on every deploy. Add:\n\n' +
        '           app.enableShutdownHooks();\n',
    );
  }

  if (/setGlobalPrefix\(/.test(main)) {
    const prefix = (main.match(/setGlobalPrefix\(['"]([^'"]+)['"]\)/) ?? [])[1];
    info(`global prefix: /${prefix ?? '(dynamic)'} — health check path is /${prefix ?? ''}/health`);
  }
}

// Platforms want a health endpoint to decide whether a deploy succeeded.
const healthPath = join(TARGET, 'src', 'health', 'health.controller.ts');
if (existsSync(healthPath)) pass('health endpoint present');
else warn('no src/health/health.controller.ts', 'Platforms use it to verify a deploy is live.');

// --- 6. storage -------------------------------------------------------------
section('6. File storage');

const storageDir = join(TARGET, 'src', 'providers', 'storage');
const hasBlob = existsSync(join(storageDir, 'blob-storage.provider.ts'));
const hasLocal = existsSync(join(storageDir, 'local-storage.provider.ts'));
const hasModule = existsSync(join(storageDir, 'storage.module.ts'));

if (hasLocal && hasModule) pass('storage providers present');
else fail('src/providers/storage is incomplete', 'The backend fix package restores these.');

if (hasBlob) info('Blob provider available (needed only on serverless hosts)');

// --- 7. environment ---------------------------------------------------------
section('7. Environment variables');

const envRaw = read(join(TARGET, '.env')) ?? '';
const env = {};
for (const line of envRaw.split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

if (!envRaw) {
  info('no local .env — checking is limited; set these in the platform dashboard');
}

const dbUrl = env.DATABASE_URL ?? '';
const directUrl = env.DIRECT_URL ?? '';

if (dbUrl) {
  const pooled = dbUrl.includes('-pooler');
  const pgbouncer = dbUrl.includes('pgbouncer=true');
  const ssl = dbUrl.includes('sslmode=require');

  if (pooled && pgbouncer) {
    pass('DATABASE_URL is pooled with pgbouncer=true');
  } else if (pooled && !pgbouncer) {
    fail(
      'DATABASE_URL is pooled but missing pgbouncer=true',
      'Without it Prisma uses prepared statements, which PgBouncer in\n' +
        '         transaction mode rejects: `prepared statement "s0" already exists`.',
    );
  } else if (!pooled) {
    warn(
      'DATABASE_URL is not the pooled endpoint (no -pooler in the hostname)',
      'A serverless or autoscaling host will exhaust the connection limit.',
    );
  }

  if (!ssl) warn('DATABASE_URL has no sslmode=require', 'Neon requires TLS.');

  // An unencoded '@' in the password splits the URL in the wrong place. A valid
  // connection string has exactly one '@', separating credentials from host.
  const afterScheme = dbUrl.replace(/^[a-z]+:\/\//i, '');
  const atCount = (afterScheme.match(/@/g) ?? []).length;

  if (atCount > 1) {
    fail(
      'DATABASE_URL contains more than one "@"',
      'The password almost certainly holds an unencoded @. The URL then parses\n' +
        '         with the wrong host and connection fails with a misleading error.\n' +
        '         Percent-encode it: @ becomes %40, : becomes %3A, / becomes %2F.',
    );
  } else if (atCount === 1) {
    const password = afterScheme.split('@')[0].split(':').slice(1).join(':');
    if (/[:/?#\[\]]/.test(password)) {
      warn(
        'DATABASE_URL password contains reserved characters',
        'Percent-encode : / ? # [ ] in the password.',
      );
    }
  }
} else {
  info('DATABASE_URL not set locally — must be set on the platform');
}

if (directUrl) {
  if (directUrl.includes('-pooler')) {
    fail(
      'DIRECT_URL points at the pooled endpoint',
      'Migrations must use the direct endpoint. Remove -pooler from the hostname.',
    );
  } else {
    pass('DIRECT_URL is the direct (unpooled) endpoint');
  }
} else if (schema && /directUrl/.test(schema)) {
  warn('schema declares directUrl but DIRECT_URL is not set locally');
}

const secret = env.JWT_SECRET ?? '';
if (secret) {
  if (secret.length >= 32) pass(`JWT_SECRET is ${secret.length} characters`);
  else fail(`JWT_SECRET is only ${secret.length} characters`, 'The app refuses to boot below 32.');

  if (/replace-me|change-me|insecure|development/i.test(secret)) {
    fail('JWT_SECRET is still a placeholder', 'Generate one for production.');
  }
} else {
  info('JWT_SECRET not set locally — must be set on the platform');
}

const driver = env.STORAGE_DRIVER ?? '';
if (driver) {
  info(`STORAGE_DRIVER=${driver}`);
  if (driver === 'blob') {
    if (!hasBlob) fail('STORAGE_DRIVER=blob but blob-storage.provider.ts is missing');
    else if (!(pkg.dependencies ?? {})['@vercel/blob']) {
      fail('STORAGE_DRIVER=blob but @vercel/blob is not a dependency', 'npm install @vercel/blob');
    } else pass('blob driver wired and dependency present');
  }
}

if (env.CORS_ORIGINS) {
  if (env.CORS_ORIGINS.includes('localhost')) {
    warn('CORS_ORIGINS still contains localhost', 'Add the deployed frontend origin.');
  } else pass('CORS_ORIGINS set');
}

// --- 8. build readiness -----------------------------------------------------
section('8. Build readiness');

if (existsSync(join(TARGET, 'node_modules'))) pass('node_modules present');
else warn('node_modules missing', 'Run npm install before testing the build locally.');

const clientPath = join(TARGET, 'node_modules', '.prisma', 'client');
if (existsSync(clientPath)) {
  pass('Prisma client generated');
} else if (existsSync(join(TARGET, 'node_modules'))) {
  warn('Prisma client not generated', 'Run npx prisma generate.');
}

if (existsSync(join(TARGET, '.env'))) {
  const gitignore = read(join(TARGET, '..', '.gitignore')) ?? read(join(TARGET, '.gitignore')) ?? '';
  if (/^\.env\.\*$/m.test(gitignore) || /^\.env$/m.test(gitignore)) {
    pass('.env is git-ignored');
  } else {
    fail('.env exists but does not appear to be git-ignored', 'Check before committing.');
  }
}

// --- summary ----------------------------------------------------------------
console.log(`\n${'='.repeat(66)}`);

if (blocking === 0 && warnings === 0) {
  console.log(`${c.green}${c.bold}Ready to deploy.${c.reset}`);
} else if (blocking === 0) {
  console.log(`${c.yellow}${c.bold}Deployable, with ${warnings} warning(s) above.${c.reset}`);
} else {
  console.log(
    `${c.red}${c.bold}${blocking} blocking issue(s)${c.reset}` +
      `${warnings ? ` and ${warnings} warning(s)` : ''} — fix before deploying.`,
  );
}

console.log('='.repeat(66) + '\n');
process.exit(blocking === 0 ? 0 : 1);
