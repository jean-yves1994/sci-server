#!/usr/bin/env node
/**
 * Restores src/providers/storage/, which never reached your repository.
 *
 *   node install-storage.mjs "C:\path\to\sci-server"
 *   node install-storage.mjs                (run from the repo root)
 *   node install-storage.mjs . --blob       (also wire Vercel Blob storage)
 *
 * The five TS2307 errors all come from one missing directory. My original
 * archive excluded "*​/storage/*" to skip runtime uploads, and the glob also
 * matched src/providers/storage/ and stripped the source.
 *
 * By default this installs local-disk storage only, which adds no dependency
 * and gets the build green immediately. --blob adds the object-store driver
 * and the @vercel/blob dependency.
 *
 * Idempotent. Anything replaced is backed up to <name>.bak first.
 */
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const WANT_BLOB = process.argv.includes('--blob');
const START = resolve(args[0] ?? process.cwd());

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[90m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const step = (m) => console.log(`\n${c.cyan}${c.bold}==> ${m}${c.reset}`);
const ok = (m) => console.log(`    ${c.green}OK${c.reset}      ${m}`);
const skip = (m) => console.log(`    ${c.dim}--${c.reset}      ${m}`);
const warn = (m) => console.log(`    ${c.yellow}!!${c.reset}      ${m}`);
const bad = (m) => console.log(`    ${c.red}FAIL${c.reset}    ${m}`);

let changed = 0;
let problems = 0;

console.log(`${c.bold}SCI — restoring the storage provider files${c.reset}`);
console.log(`${c.dim}${START}${c.reset}`);

// --- 1. find the backend ----------------------------------------------------
step('Locating the backend');

// Two layouts have existed for this project: sci-platform kept the backend in
// backend/, sci-server has it at the repository root. Detect rather than assume.
const candidates = [START, join(START, 'backend')];
const BACKEND = candidates.find((dir) => existsSync(join(dir, 'src', 'app.module.ts')));

if (!BACKEND) {
  bad('could not find src/app.module.ts');
  console.log(`\n    Looked in:`);
  for (const dir of candidates) console.log(`      ${dir}`);
  console.log(`\n    Point this at the folder containing src/, e.g.`);
  console.log(`      node install-storage.mjs "C:\\\\path\\\\to\\\\sci-server"\n`);
  process.exit(1);
}

const where = BACKEND === START ? 'repository root' : 'backend/ subfolder';
ok(`backend found at the ${where}`);

// --- 2. confirm the diagnosis -----------------------------------------------
step('Confirming what is missing');

const storageDir = join(BACKEND, 'src', 'providers', 'storage');
const core = ['storage.provider.ts', 'local-storage.provider.ts', 'storage.module.ts'];

const missing = core.filter((f) => !existsSync(join(storageDir, f)));

if (missing.length === 0) {
  skip('all core storage files are already present');
} else {
  warn(`missing: ${missing.join(', ')}`);
  console.log(`    ${c.dim}These five files import from that directory:${c.reset}`);
  for (const importer of [
    'src/app.module.ts',
    'src/files/files.controller.ts',
    'src/photos/photos.service.ts',
    'src/reports/report-renderer.ts',
    'src/reports/reports.service.ts',
  ]) {
    const exists = existsSync(join(BACKEND, importer));
    console.log(`    ${c.dim}  ${exists ? '·' : '?'} ${importer}${c.reset}`);
  }
}

// --- 3. install -------------------------------------------------------------
step(WANT_BLOB ? 'Installing storage providers (with Blob)' : 'Installing storage providers');

mkdirSync(storageDir, { recursive: true });

function install(sourceRelative, targetName) {
  const source = join(HERE, 'files', sourceRelative);
  const target = join(storageDir, targetName);

  if (!existsSync(source)) {
    bad(`bundled file missing: ${sourceRelative}`);
    problems += 1;
    return;
  }

  const incoming = readFileSync(source, 'utf8');

  if (existsSync(target)) {
    if (readFileSync(target, 'utf8') === incoming) {
      skip(`${targetName} already up to date`);
      return;
    }
    copyFileSync(target, `${target}.bak`);
    warn(`${targetName} differed — original saved as ${targetName}.bak`);
  }

  writeFileSync(target, incoming, 'utf8');
  ok(targetName);
  changed += 1;
}

install('src/providers/storage/storage.provider.ts', 'storage.provider.ts');
install('src/providers/storage/local-storage.provider.ts', 'local-storage.provider.ts');

if (WANT_BLOB) {
  install('optional/blob-storage.provider.ts', 'blob-storage.provider.ts');
  install('optional/storage.module.blob.ts', 'storage.module.ts');
} else {
  install('src/providers/storage/storage.module.ts', 'storage.module.ts');
}

// --- 4. dependency ----------------------------------------------------------
step('Dependencies');

const pkgPath = join(BACKEND, 'package.json');

if (!existsSync(pkgPath)) {
  bad('package.json not found');
  problems += 1;
} else {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies ??= {};

  if (WANT_BLOB) {
    if (pkg.dependencies['@vercel/blob']) {
      skip(`@vercel/blob already present (${pkg.dependencies['@vercel/blob']})`);
    } else {
      pkg.dependencies['@vercel/blob'] = '^0.27.0';
      writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
      ok('added @vercel/blob');
      warn('run "npm install" before building, or the build will fail on this import');
      changed += 1;
    }
  } else {
    skip('no new dependency needed — local storage uses only the standard library');

    // Shipping the blob provider without its package would trade five errors
    // for one. Flag it if a stray copy is present.
    if (existsSync(join(storageDir, 'blob-storage.provider.ts')) &&
        !pkg.dependencies['@vercel/blob']) {
      warn('blob-storage.provider.ts is present but @vercel/blob is not installed');
      console.log(`    ${c.dim}That file alone will fail to compile. Either run this with --blob,`);
      console.log(`    ${c.dim}or delete src/providers/storage/blob-storage.provider.ts.${c.reset}`);
      problems += 1;
    }
  }
}

// --- 5. verify the importers can resolve ------------------------------------
step('Verifying the five failing imports');

const importers = [
  ['src/app.module.ts', './providers/storage/storage.module'],
  ['src/files/files.controller.ts', '../providers/storage/storage.provider'],
  ['src/photos/photos.service.ts', '../providers/storage/storage.provider'],
  ['src/reports/report-renderer.ts', '../providers/storage/storage.provider'],
  ['src/reports/reports.service.ts', '../providers/storage/storage.provider'],
];

let unresolved = 0;

for (const [file, spec] of importers) {
  const fullPath = join(BACKEND, file);

  if (!existsSync(fullPath)) {
    warn(`${file} not found — skipping`);
    continue;
  }

  // Resolve the specifier exactly as TypeScript would, from the importer's own
  // directory, and confirm the target file now exists.
  const resolved = resolve(dirname(fullPath), spec);
  const found = [`${resolved}.ts`, join(resolved, 'index.ts')].some(existsSync);

  if (found) ok(`${file} → ${spec}`);
  else {
    bad(`${file} → ${spec} still unresolved`);
    unresolved += 1;
  }
}

if (unresolved > 0) problems += unresolved;

// --- 6. named exports -------------------------------------------------------
step('Checking the expected exports');

const expected = [
  ['storage.provider.ts', 'StorageProvider'],
  ['storage.provider.ts', 'StoredObject'],
  ['storage.module.ts', 'StorageModule'],
  ['local-storage.provider.ts', 'LocalStorageProvider'],
];

for (const [file, name] of expected) {
  const path = join(storageDir, file);
  if (!existsSync(path)) { bad(`${file} missing`); problems += 1; continue; }

  const text = readFileSync(path, 'utf8');
  const exported = new RegExp(
    `export\\s+(?:abstract\\s+)?(?:class|interface|type|const)\\s+${name}\\b`,
  ).test(text);

  if (exported) ok(`${file} exports ${name}`);
  else { bad(`${file} does not export ${name}`); problems += 1; }
}

// --- summary ----------------------------------------------------------------
console.log(`\n${'='.repeat(66)}`);

if (problems === 0) {
  console.log(`${c.green}${c.bold}Done.${c.reset} ${changed} file(s) written.\n`);
  console.log('Build locally before pushing — it is faster to fail here:');
  console.log(`  cd "${BACKEND}"`);
  if (WANT_BLOB) console.log('  npm install');
  console.log('  npm run build\n');
  console.log('Then:');
  console.log('  git add -A');
  console.log('  git commit -m "Restore storage provider files"');
  console.log('  git push\n');

  if (!WANT_BLOB) {
    console.log(`${c.dim}Note: this installs local-disk storage. On a serverless host the`);
    console.log(`${c.dim}filesystem does not persist, so uploads would be lost between`);
    console.log(`${c.dim}requests. Re-run with --blob if you are deploying to Vercel.${c.reset}\n`);
  }
} else {
  console.log(`${c.yellow}${c.bold}${problems} item(s) need attention — see above.${c.reset}\n`);
}

console.log('='.repeat(66) + '\n');
process.exit(problems === 0 ? 0 : 1);
