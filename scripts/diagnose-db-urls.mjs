#!/usr/bin/env node
/**
 * Safe Prisma connection-string diagnostics for CI/Vercel.
 * Never prints credentials, database names, query parameters, or full URLs.
 */
const names = ["DATABASE_URL", "DIRECT_URL"];
let failed = false;

for (const name of names) {
  const raw = process.env[name];

  if (typeof raw !== "string" || raw.length === 0) {
    console.error(`[db-url-check] FAIL ${name}: variable is missing or empty in this deployment environment.`);
    failed = true;
    continue;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    const prefix = raw.trimStart().slice(0, 24).replace(/[^a-zA-Z0-9:+./_-]/g, "?");
    console.error(`[db-url-check] FAIL ${name}: value is not parseable as a URL (safe prefix: "${prefix}"). Check for a pasted command, wrapping quotes, whitespace, or an incomplete value.`);
    failed = true;
    continue;
  }

  const protocol = parsed.protocol.toLowerCase();
  const supported = protocol === "postgresql:" || protocol === "postgres:";
  const host = parsed.hostname || "(empty-host)";
  const hasCredentials = Boolean(parsed.username && parsed.password);
  console.log(`[db-url-check] ${name}: scheme=${protocol || "(none)"} host=${host} credentials=${hasCredentials ? "present" : "missing"}`);

  if (!supported) {
    console.error(`[db-url-check] FAIL ${name}: Prisma PostgreSQL expects postgresql:// or postgres://; received scheme ${protocol || "(none)"}.`);
    failed = true;
  }
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") {
    console.error(`[db-url-check] FAIL ${name}: host or database path is missing.`);
    failed = true;
  }
  if (!hasCredentials) {
    console.error(`[db-url-check] FAIL ${name}: username/password credentials are missing from the parsed URL.`);
    failed = true;
  }
  if (name === "DIRECT_URL" && host.includes("-pooler")) {
    console.error("[db-url-check] FAIL DIRECT_URL: hostname contains -pooler; Prisma migrations should use Neon’s direct endpoint.");
    failed = true;
  }
}

if (failed) {
  console.error("[db-url-check] Fix the indicated Vercel environment variable(s); no secret values were printed.");
  process.exit(1);
}

console.log("[db-url-check] Both connection strings passed basic URL parsing. This does not prove database reachability or permissions.");
