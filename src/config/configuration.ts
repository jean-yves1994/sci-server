/**
 * Configuration is validated once, at boot, so a misconfigured deployment fails
 * immediately and legibly rather than at the first login attempt.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  jwtSecret: string;
  jwtAccessTtl: string;
  refreshTtlDays: number;
  corsOrigins: string[];
  maxUploadBytes: number;
}

export function loadConfig(): AppConfig {
  const problems: string[] = [];

  if (!process.env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  }

  const jwtSecret = process.env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    problems.push(
      'JWT_SECRET must be at least 32 characters. Generate one with:\n' +
        '      node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const originsRaw = process.env.CORS_ORIGINS ?? 'http://localhost:3000';

  // A wildcard origin combined with credentialed requests would let any site
  // act on a signed-in user's behalf.
  if (nodeEnv === 'production' && originsRaw.trim() === '*') {
    problems.push('CORS_ORIGINS may not be "*" in production.');
  }

  if (problems.length > 0) {
    throw new Error(`Configuration is invalid:\n\n  - ${problems.join('\n  - ')}\n`);
  }

  return {
    nodeEnv,
    port: Number(process.env.PORT ?? 4000),
    jwtSecret,
    jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7),
    corsOrigins: originsRaw.split(',').map((o) => o.trim()).filter(Boolean),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024),
  };
}
