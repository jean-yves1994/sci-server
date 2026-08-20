import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Field-level encryption for personally identifying data (national ID numbers).
 *
 * Disk encryption protects a stolen server; it does nothing against a leaked
 * backup or an over-broad SELECT. Encrypting in the application means reading
 * the column yields ciphertext. AES-GCM is authenticated, so tampering causes
 * decryption to fail loudly rather than silently returning altered data.
 */
function deriveKey(secret: string): Buffer {
  // A fixed salt is acceptable because the input is already a high-entropy
  // secret rather than a human-chosen password.
  return scryptSync(secret, 'sci-field-encryption', 32);
}

export function encryptField(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptField(ciphertext: string, secret: string): string | null {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(parts[0], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[1], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key or tampered ciphertext; degrade gracefully rather than 500.
    return null;
  }
}

/**
 * Deterministic blind index so an encrypted national ID stays searchable.
 * Keyed with HMAC rather than a bare hash: ID numbers occupy a small,
 * predictable space that an unkeyed hash would expose to a rainbow table.
 */
export function blindIndex(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value.trim().toUpperCase()).digest('hex');
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
