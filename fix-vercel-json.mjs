#!/usr/bin/env node
/**
 * Removes the `functions` block that breaks the Vercel build.
 *
 *   node fix-vercel-json.mjs "C:\path\to\sci-server"
 *   node fix-vercel-json.mjs            (run from the repo root)
 *
 * The vercel.json I gave you contained:
 *
 *   { "functions": { "src/main.ts": { "maxDuration": 60 } } }
 *
 * The `functions` key CONFIGURES files Vercel has already detected as
 * serverless functions. It does not create one. With no api/ directory —
 * which a NestJS project does not have — the pattern matches nothing and
 * Vercel refuses to build, in about 50ms, before installing anything.
 *
 * Idempotent. The original is backed up to vercel.json.bak.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TARGET = resolve(process.argv[2] ?? process.cwd());

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[90m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const step = (m) => console.log(`\n${c.cyan}${c.bold}==> ${m}${c.reset}`);
const ok = (m) => console.log(`    ${c.green}OK${c.reset}      ${m}`);
const skip = (m) => console.log(`    ${c.dim}--${c.reset}      ${m}`);
const warn = (m) => console.log(`    ${c.yellow}!!${c.reset}      ${m}`);
const bad = (m) => console.log(`    ${c.red}FAIL${c.reset}    ${m}`);

/**
 * Strips // and comments from JSONC without touching string contents.
 *
 * A regex cannot do this safely: a config may contain "@/*" or "**\/*.ts",
 * so `/*` and `*\/` appear inside strings and a naive pattern deletes half
 * the file. This walks character by character instead.
 */
function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLine) { if (ch === '\n') { inLine = false; out += ch; } continue; }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i += 1; } continue; }
    if (inString) {
      out += ch;
      if (ch === '\\') { out += text[i + 1] ?? ''; i += 1; }
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') { inLine = true; i += 1; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i += 1; continue; }

    out += ch;
  }

  return out.replace(/,(\s*[}\]])/g, '$1');
}

console.log(`${c.bold}Vercel build fix — removing the functions block${c.reset}`);
console.log(`${c.dim}${TARGET}${c.reset}`);

// The backend may be at the repo root (sci-server) or in a backend/ folder.
const candidates = [
  join(TARGET, 'vercel.json'),
  join(TARGET, 'backend', 'vercel.json'),
];

const found = candidates.filter(existsSync);

step('Locating vercel.json');

if (found.length === 0) {
  skip('no vercel.json found');
  console.log(`\n${'='.repeat(64)}`);
  console.log(`${c.green}${c.bold}Nothing to fix.${c.reset}`);
  console.log(`${c.dim}Without a vercel.json, Vercel uses zero-config detection, which is`);
  console.log(`${c.dim}what a NestJS project wants. If the build still fails, the Framework`);
  console.log(`${c.dim}Preset in project settings is the thing to check.${c.reset}`);
  console.log('='.repeat(64) + '\n');
  process.exit(0);
}

let changed = 0;
let problems = 0;

for (const path of found) {
  const shown = path.replace(TARGET, '.');
  console.log(`    found ${shown}`);

  const raw = readFileSync(path, 'utf8');
  let config;

  try {
    config = JSON.parse(stripJsonComments(raw));
  } catch (error) {
    bad(`${shown} is not valid JSON — ${error.message}`);
    problems += 1;
    continue;
  }

  step(`Checking ${shown}`);

  const hasFunctions = 'functions' in config;
  const hasBuilds = 'builds' in config;

  if (!hasFunctions && !hasBuilds) {
    skip('no functions or builds block — already correct');
    continue;
  }

  if (hasFunctions) {
    const patterns = Object.keys(config.functions);
    warn(`functions block present: ${patterns.join(', ')}`);
    console.log(`    ${c.dim}This is what fails the build. The key configures files Vercel has`);
    console.log(`    ${c.dim}already detected as functions — it does not create one. With no`);
    console.log(`    ${c.dim}api/ directory the pattern matches nothing.${c.reset}`);
    delete config.functions;
  }

  if (hasBuilds) {
    // A legacy `builds` array disables framework detection entirely, which
    // produces the same class of failure by a different route.
    warn('builds block present — this disables framework auto-detection');
    delete config.builds;
  }

  copyFileSync(path, `${path}.bak`);

  const remaining = Object.keys(config).filter((k) => k !== '$schema');

  if (remaining.length === 0) {
    // An empty vercel.json is harmless but pointless. Removing it makes the
    // zero-config behaviour obvious rather than implied.
    unlinkSync(path);
    ok(`${shown} removed — nothing left in it (original saved as ${shown}.bak)`);
    console.log(`    ${c.dim}Zero-config detection is what a NestJS project wants.${c.reset}`);
  } else {
    config.$schema ??= 'https://openapi.vercel.sh/vercel.json';
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    ok(`${shown} rewritten, keeping: ${remaining.join(', ')}`);
    console.log(`    ${c.dim}Original saved as ${shown}.bak${c.reset}`);
  }

  changed += 1;
}

// --- the other half of the problem ------------------------------------------
step('Also check in the Vercel dashboard');
console.log(`    ${c.dim}Settings -> General -> Framework Preset${c.reset}`);
console.log('');
console.log(`    My earlier instructions said "Other". That is the second half of`);
console.log(`    this failure: with "Other", Vercel skips NestJS detection, falls`);
console.log(`    back to scanning api/ for functions, and finds nothing.`);
console.log('');
console.log(`    ${c.bold}Set Framework Preset to "Other" only if there is no NestJS option;${c.reset}`);
console.log(`    ${c.bold}otherwise let Vercel auto-detect it.${c.reset}`);

console.log(`\n${'='.repeat(64)}`);
if (problems > 0) {
  console.log(`${c.yellow}${c.bold}${problems} file(s) need manual attention.${c.reset}`);
} else if (changed > 0) {
  console.log(`${c.green}${c.bold}Done.${c.reset} Commit and push:\n`);
  console.log('  git add -A');
  console.log('  git commit -m "Remove functions block that blocked the Vercel build"');
  console.log('  git push\n');
} else {
  console.log(`${c.green}${c.bold}Already correct.${c.reset}\n`);
}
console.log('='.repeat(64) + '\n');

process.exit(problems > 0 ? 1 : 0);
