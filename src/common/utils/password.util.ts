import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string, salt: Buffer, keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PREFIX = 'scrypt';

/**
 * Password hashing on Node's own scrypt.
 *
 * scrypt is memory-hard and in the standard library, so there is no native
 * module to compile. That is deliberate: argon2 and bcrypt both need a C++
 * toolchain, and a missing toolchain turns `npm install` into a wall of build
 * errors on a developer's Windows machine before the project even starts.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Comparison is timing-safe: a plain `===` leaks how many leading bytes
 * matched. A malformed hash returns false rather than throwing, so one corrupt
 * row denies access instead of returning a 500 that reveals the row is corrupt.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], 'hex');
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;

  const actual = await scrypt(password, salt, KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

export function generateToken(): string {
  return randomBytes(48).toString('base64url');
}

/** Tokens are stored hashed, so a database leak yields nothing usable. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface PasswordPolicyResult { valid: boolean; failures: string[] }

/**
 * Length is weighted over symbol classes because it contributes far more real
 * entropy; a 14-character passphrase beats "P@ss1!" comfortably.
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  const failures: string[] = [];
  if (password.length < 12) failures.push('be at least 12 characters long');
  if (!/[a-z]/.test(password)) failures.push('include a lowercase letter');
  if (!/[A-Z]/.test(password)) failures.push('include an uppercase letter');
  if (!/\d/.test(password)) failures.push('include a digit');

  const common = ['password', '12345678', 'qwerty', 'letmein', 'admin123', 'welcome1'];
  if (common.some((entry) => password.toLowerCase().includes(entry))) {
    failures.push('not contain a commonly used password');
  }
  return { valid: failures.length === 0, failures };
}
