#!/usr/bin/env node
/**
 * Gets the storage files into your repository, where Vercel can see them.
 *
 *   node fix-storage-git.mjs "C:\path\to\sci-server"
 *   node fix-storage-git.mjs              (run from the repo root)
 *
 * The same five TS2307 errors after a fix means the files are still not in the
 * repo. Vercel compiles what git has, not what is on your disk.
 *
 * There is a reason for that beyond forgetting to commit, and it is my fault:
 * the .gitignore I gave you contains `storage/`. A gitignore pattern with no
 * leading slash matches at ANY depth, so it silently excludes
 * src/providers/storage/ — the source directory — as well as the runtime
 * uploads folder it was meant for. `git add -A` skips it without a word.
 *
 * This script writes the files, fixes the pattern, force-adds them, and then
 * verifies with `git ls-files` that they are genuinely in the index. That last
 * check is the one that matters: it is the difference between "it works on my
 * machine" and "it is in the repository".
 *
 * Idempotent.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
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

let problems = 0;
let changed = 0;

/** Runs git, returning trimmed stdout or null. Never throws. */
function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

console.log(`${c.bold}SCI — getting the storage files into the repository${c.reset}`);
console.log(`${c.dim}${START}${c.reset}`);

// --- 1. locate --------------------------------------------------------------
step('Locating the backend and the git repository');

// The backend has lived at the repo root (sci-server) and in backend/
// (sci-platform). Detect rather than assume.
const BACKEND = [START, join(START, 'backend')]
  .find((dir) => existsSync(join(dir, 'src', 'app.module.ts')));

if (!BACKEND) {
  bad('could not find src/app.module.ts');
  console.log(`\n    Looked in ${START} and ${join(START, 'backend')}`);
  console.log(`\n    Point this at the folder containing src/:`);
  console.log(`      node fix-storage-git.mjs "C:\\\\path\\\\to\\\\sci-server"\n`);
  process.exit(1);
}
ok(`backend at ${BACKEND === START ? 'the repository root' : 'backend/'}`);

const REPO = git(['rev-parse', '--show-toplevel'], BACKEND);
if (!REPO) {
  bad('not inside a git repository');
  console.log('\n    Vercel builds from git, so the files must be committed.\n');
  process.exit(1);
}
ok(`git repository at ${REPO}`);

const storageDir = join(BACKEND, 'src', 'providers', 'storage');
const relStorage = storageDir.replace(REPO, '').replace(/^[\\/]/, '').replace(/\\/g, '/');

// --- 2. what git currently knows --------------------------------------------
step('What git currently has');

const tracked = (git(['ls-files', relStorage], REPO) ?? '')
  .split('\n').filter(Boolean);

if (tracked.length > 0) {
  ok(`${tracked.length} file(s) already tracked:`);
  for (const f of tracked) console.log(`            ${f}`);
} else {
  // This is the finding that explains the repeated failure.
  bad(`no files tracked under ${relStorage}`);
  console.log(`    ${c.dim}Vercel compiles the repository, so this is exactly why the${c.reset}`);
  console.log(`    ${c.dim}build still fails with the same five errors.${c.reset}`);
}

const onDisk = existsSync(storageDir);
console.log(`    ${c.dim}on disk: ${onDisk ? 'directory exists' : 'directory missing'}${c.reset}`);

// --- 3. the gitignore trap --------------------------------------------------
step('Checking whether git is ignoring the directory');

const probe = join(relStorage, 'storage.provider.ts');
const ignoreRule = git(['check-ignore', '-v', probe], REPO);

if (ignoreRule) {
  bad('git is ignoring this path');
  console.log(`    ${c.dim}rule: ${ignoreRule}${c.reset}`);
  console.log('');
  console.log(`    A gitignore pattern with no leading slash matches at ANY depth.`);
  console.log(`    So "storage/" excludes src/providers/storage/ as well as the`);
  console.log(`    runtime uploads folder it was written for.`);
  console.log('');
  console.log(`    ${c.dim}This is my mistake — the same class of error as the archive${c.reset}`);
  console.log(`    ${c.dim}exclusion that lost these files in the first place.${c.reset}`);
} else {
  ok('not ignored');
}

// --- 4. fix the pattern -----------------------------------------------------
step('Anchoring the gitignore patterns');

const gitignorePath = join(REPO, '.gitignore');

if (!existsSync(gitignorePath)) {
  skip('no .gitignore at the repository root');
} else {
  const before = readFileSync(gitignorePath, 'utf8');
  let after = before;

  // Anchor to the repository root with a leading slash, so these match only
  // the top-level runtime directories and never a nested source folder.
  const rewrites = [
    [/^storage\/$/m, '/storage/'],
    [/^uploads\/$/m, '/uploads/'],
    [/^tmp\/$/m, '/tmp/'],
  ];

  for (const [pattern, replacement] of rewrites) {
    if (pattern.test(after)) {
      after = after.replace(pattern, replacement);
      ok(`anchored ${replacement.slice(1)} to the repository root`);
    }
  }

  // Belt and braces: an explicit negation, in case another rule also matches.
  if (!after.includes('!src/providers/storage/')) {
    after = `${after.trimEnd()}\n
# The storage PROVIDER is source code, unlike the storage/ upload directory.
# Negated explicitly so no future pattern can quietly exclude it again.
!src/providers/storage/
!backend/src/providers/storage/

# Backups written by the fix scripts. Never source.
*.bak
`;
    ok('added an explicit negation for the provider directory');
  }

  if (after !== before) {
    copyFileSync(gitignorePath, `${gitignorePath}.bak`);
    writeFileSync(gitignorePath, after, 'utf8');
    ok('.gitignore updated (original saved as .gitignore.bak)');
    changed += 1;
  } else {
    skip('.gitignore already correct');
  }
}

// --- 5. write the files -----------------------------------------------------
step('Writing the storage files');

mkdirSync(storageDir, { recursive: true });

for (const name of ['storage.provider.ts', 'local-storage.provider.ts', 'storage.module.ts']) {
  const source = join(HERE, 'files', name);
  const target = join(storageDir, name);

  if (!existsSync(source)) {
    bad(`bundled file missing: ${name}`);
    problems += 1;
    continue;
  }

  const incoming = readFileSync(source, 'utf8');

  if (existsSync(target) && readFileSync(target, 'utf8') === incoming) {
    skip(`${name} already up to date`);
    continue;
  }

  if (existsSync(target)) copyFileSync(target, `${target}.bak`);
  writeFileSync(target, incoming, 'utf8');
  ok(name);
  changed += 1;
}

// --- 6. stage them ----------------------------------------------------------
step('Staging');

// Staged by name, not by directory. Adding the whole directory would also
// stage the .bak files this script creates, committing backups into the
// repository — which nobody wants and which is easy to miss.
//
// -f overrides any remaining ignore rule: the pattern fix above should make it
// unnecessary, but a stray rule elsewhere would otherwise fail silently, and
// silent failure is the entire problem being solved here.
const toStage = ['storage.provider.ts', 'local-storage.provider.ts', 'storage.module.ts']
  .map((name) => `${relStorage}/${name}`)
  .filter((rel) => existsSync(join(REPO, rel)));

const added = toStage.length > 0 ? git(['add', '-f', ...toStage], REPO) : '';

if (added === null) {
  bad('git add failed');
  problems += 1;
} else {
  const staged = (git(['diff', '--cached', '--name-only'], REPO) ?? '')
    .split('\n').filter((f) => f.includes('providers/storage'));

  if (staged.length > 0) {
    ok(`${staged.length} file(s) staged:`);
    for (const f of staged) console.log(`            ${f}`);
  } else if (tracked.length > 0) {
    skip('already committed and unchanged');
  } else {
    bad('nothing staged — the files are still not reaching git');
    problems += 1;
  }
}

// --- 7. the check that actually matters -------------------------------------
step('Verifying git can see the files');

const nowTracked = (git(['ls-files', '--cached', relStorage], REPO) ?? '')
  .split('\n').filter(Boolean);

const stagedNow = (git(['diff', '--cached', '--name-only'], REPO) ?? '')
  .split('\n').filter((f) => f.includes('providers/storage'));

const visible = new Set([...nowTracked, ...stagedNow]);

const required = ['storage.provider.ts', 'local-storage.provider.ts', 'storage.module.ts'];
let allVisible = true;

for (const name of required) {
  const present = [...visible].some((f) => f.endsWith(name));
  if (present) ok(`${name} is in the git index`);
  else { bad(`${name} is NOT in the git index`); allVisible = false; problems += 1; }
}

if (allVisible) {
  console.log('');
  console.log(`    ${c.dim}This is the check that matters. Files on disk do not build on${c.reset}`);
  console.log(`    ${c.dim}Vercel; files in the index do.${c.reset}`);
}

// Confirm the original intent still holds — runtime uploads stay out.
const uploadProbe = 'storage/inspections/example.jpg';
if (git(['check-ignore', '-q', uploadProbe], REPO) !== null) {
  ok('runtime uploads (storage/) are still ignored');
} else {
  warn('storage/ no longer appears to be ignored — check .gitignore');
}

// --- summary ----------------------------------------------------------------
console.log(`\n${'='.repeat(66)}`);

if (problems === 0) {
  console.log(`${c.green}${c.bold}Done.${c.reset} ${changed} change(s).\n`);
  console.log('Commit and push:\n');
  console.log('  git commit -m "Add storage provider files"');
  console.log('  git push\n');
  console.log(`${c.dim}Then confirm they really arrived, from the repo root:${c.reset}`);
  console.log(`  git ls-files ${relStorage}\n`);
  console.log(`${c.dim}Three files listed means Vercel will see them.${c.reset}\n`);
} else {
  console.log(`${c.yellow}${c.bold}${problems} item(s) need attention — see above.${c.reset}\n`);
}

console.log('='.repeat(66) + '\n');
process.exit(problems === 0 ? 0 : 1);
