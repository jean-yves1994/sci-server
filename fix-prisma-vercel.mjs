#!/usr/bin/env node
/**
 * Fixes PrismaClientInitializationError on Vercel.
 *
 *   node fix-prisma-vercel.mjs "C:\path\to\sci-server"
 *   node fix-prisma-vercel.mjs              (run from the repo root)
 *
 * The build succeeded; this is a runtime failure. @prisma/client is not an
 * ordinary package — its client code is GENERATED from your schema by an
 * install hook. Vercel caches node_modules between builds, so on a cached
 * install the hook never fires and the client is stale or missing.
 *
 * Three things have to be true for the fix to hold:
 *
 *   1. "postinstall": "prisma generate"   — runs after EVERY install,
 *      cached or not. This is the guarantee.
 *
 *   2. "vercel-build": "prisma generate && nest build" — belt and braces.
 *      Weaker alone, because a Build Command set in the Vercel dashboard
 *      overrides it entirely.
 *
 *   3. `prisma` (the CLI) must be resolvable during the build. It ships as a
 *      devDependency by default, and if NODE_ENV=production is set as a Vercel
 *      environment variable, npm omits devDependencies — so postinstall fails
 *      with "prisma: command not found" instead.
 *
 * Idempotent. package.json is backed up before any change.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const START = resolve(process.argv[2] ?? process.cwd());

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[90m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const step = (m) => console.log(`\n${c.cyan}${c.bold}==> ${m}${c.reset}`);
const ok = (m) => console.log(`    ${c.green}OK${c.reset}      ${m}`);
const skip = (m) => console.log(`    ${c.dim}--${c.reset}      ${m}`);
const warn = (m) => console.log(`    ${c.yellow}!!${c.reset}      ${m}`);
const bad = (m) => console.log(`    ${c.red}FAIL${c.reset}    ${m}`);
const info = (m) => console.log(`    ${c.dim}${m}${c.reset}`);

let changed = 0;
let problems = 0;

// --- locate -----------------------------------------------------------------
const BACKEND = [START, join(START, 'backend')]
  .find((dir) => existsSync(join(dir, 'package.json')));

if (!BACKEND) {
  bad(`no package.json found under ${START}`);
  console.log('\n    Point this at the folder containing package.json.\n');
  process.exit(1);
}

console.log(`${c.bold}Prisma on Vercel — build configuration fix${c.reset}`);
console.log(`${c.dim}${BACKEND}${c.reset}`);

const pkgPath = join(BACKEND, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const original = JSON.stringify(pkg);

pkg.scripts ??= {};
pkg.dependencies ??= {};
pkg.devDependencies ??= {};

// --- 1. schema present ------------------------------------------------------
step('Prisma schema');

const schemaPath = join(BACKEND, 'prisma', 'schema.prisma');

if (existsSync(schemaPath)) {
  ok('prisma/schema.prisma found');
} else {
  bad('prisma/schema.prisma not found');
  info('`prisma generate` has nothing to generate from.');
  problems += 1;
}

// --- 2. postinstall ---------------------------------------------------------
step('postinstall script');
info('This is the actual fix. It runs after every npm install on Vercel,');
info('cached or not, so the client is always regenerated from the schema.');

const existingPost = pkg.scripts.postinstall;

if (existingPost && /prisma\s+generate/.test(existingPost)) {
  skip(`already present: "${existingPost}"`);
} else if (existingPost) {
  // Preserve whatever else it does rather than clobbering it.
  pkg.scripts.postinstall = `prisma generate && ${existingPost}`;
  ok(`prepended prisma generate: "${pkg.scripts.postinstall}"`);
  changed += 1;
} else {
  pkg.scripts.postinstall = 'prisma generate';
  ok('added "postinstall": "prisma generate"');
  changed += 1;
}

// --- 3. the CLI has to be resolvable ----------------------------------------
step('prisma CLI availability');

const prismaInDeps = pkg.dependencies.prisma;
const prismaInDev = pkg.devDependencies.prisma;

if (prismaInDeps) {
  ok(`prisma is a dependency (${prismaInDeps})`);
} else if (prismaInDev) {
  // The trap: with NODE_ENV=production set as a Vercel env var, npm omits
  // devDependencies, the CLI is absent, and postinstall fails with
  // "prisma: command not found" — a different error, same dead deploy.
  warn(`prisma is only a devDependency (${prismaInDev})`);
  info('If NODE_ENV=production is set in your Vercel environment variables,');
  info('npm omits devDependencies and the CLI will not be there for');
  info('postinstall. Prisma\'s own docs recommend moving it.');

  pkg.dependencies.prisma = prismaInDev;
  delete pkg.devDependencies.prisma;
  ok(`moved prisma to dependencies (${prismaInDeps ?? prismaInDev})`);
  changed += 1;
} else {
  bad('prisma is not in dependencies or devDependencies');
  info('Install it: npm install prisma');
  problems += 1;
}

if (!pkg.dependencies['@prisma/client']) {
  if (pkg.devDependencies['@prisma/client']) {
    pkg.dependencies['@prisma/client'] = pkg.devDependencies['@prisma/client'];
    delete pkg.devDependencies['@prisma/client'];
    ok('moved @prisma/client to dependencies — it is needed at runtime');
    changed += 1;
  } else {
    bad('@prisma/client is not a dependency');
    problems += 1;
  }
} else {
  ok(`@prisma/client is a dependency (${pkg.dependencies['@prisma/client']})`);
}

// --- 4. vercel-build --------------------------------------------------------
step('vercel-build script');
info('Belt and braces. Weaker than postinstall on its own, because a Build');
info('Command set in the Vercel dashboard overrides it completely.');

const buildScript = pkg.scripts.build ?? 'nest build';
const wanted = `prisma generate && ${buildScript}`;

if (pkg.scripts['vercel-build'] && /prisma\s+generate/.test(pkg.scripts['vercel-build'])) {
  skip(`already present: "${pkg.scripts['vercel-build']}"`);
} else {
  pkg.scripts['vercel-build'] = wanted;
  ok(`added "vercel-build": "${wanted}"`);
  changed += 1;
}

// Leaving `build` clean keeps local builds fast; generation is handled by
// postinstall locally too.
if (/prisma\s+generate/.test(pkg.scripts.build ?? '')) {
  info('');
  info('Note: your "build" script also runs prisma generate. Harmless, just');
  info('slower locally. postinstall already covers it.');
}

// --- 5. save ----------------------------------------------------------------
step('Saving');

if (JSON.stringify(pkg) === original) {
  skip('package.json already correct — nothing written');
} else {
  copyFileSync(pkgPath, `${pkgPath}.bak`);
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  ok('package.json updated (original saved as package.json.bak)');
}

// --- 6. what to check in the dashboard --------------------------------------
step('Check this in the Vercel dashboard');
info('Settings -> General -> Build & Development Settings');
info('');
info('If Build Command is OVERRIDDEN to something, make it:');
info('');
console.log(`      ${c.bold}npm run vercel-build${c.reset}`);
info('');
info('If it is not overridden, leave it — Vercel will find vercel-build');
info('automatically, and postinstall runs either way.');
info('');
info('Also check Environment Variables for NODE_ENV. If it is set to');
info('"production", devDependencies are omitted at install time. Moving');
info('prisma to dependencies above makes that safe, but it is worth');
info('knowing why.');

// --- summary ----------------------------------------------------------------
console.log(`\n${'='.repeat(66)}`);

if (problems === 0) {
  console.log(`${c.green}${c.bold}Done.${c.reset} ${changed} change(s).\n`);
  console.log('Commit and redeploy:\n');
  console.log('  git add package.json');
  console.log('  git commit -m "Run prisma generate during the Vercel build"');
  console.log('  git push\n');
  console.log(`${c.dim}Vercel rebuilds on push. Watch the log for a line like${c.reset}`);
  console.log(`${c.dim}"Generated Prisma Client" during the install step.${c.reset}\n`);
} else {
  console.log(`${c.yellow}${c.bold}${problems} item(s) need attention — see above.${c.reset}\n`);
}

console.log('='.repeat(66) + '\n');
process.exit(problems === 0 ? 0 : 1);
