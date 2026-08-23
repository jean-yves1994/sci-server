import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { StorageProvider, StoredObject } from './storage.provider';

/**
 * Filesystem-backed storage.
 *
 * Right for development and for any host with a persistent disk. Not suitable
 * on a serverless platform, where the filesystem does not survive between
 * invocations: writes succeed, the API returns 200, and the file is gone by the
 * next request.
 */
@Injectable()
export class LocalStorageProvider extends StorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name);
  private readonly root: string;
  private readonly signingSecret: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.root = resolve(this.config.get<string>('STORAGE_LOCAL_PATH') ?? './storage');
    this.signingSecret = this.config.get<string>('JWT_SECRET') ?? 'insecure-development-secret';
    this.publicBaseUrl =
      this.config.get<string>('PUBLIC_API_URL') ?? 'https://sci-server.vercel.app/api/v1';
  }

  /**
   * Resolves a key to an absolute path, refusing anything that escapes the root.
   *
   * Keys are server-generated today, but validating here means a future
   * endpoint accepting a caller-supplied key cannot become a path-traversal
   * hole.
   */
  private resolveKey(key: string): string {
    const target = resolve(join(this.root, normalize(key)));

    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error('Resolved storage path escapes the storage root');
    }
    return target;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<StoredObject> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);

    return {
      key,
      sizeBytes: body.byteLength,
      checksumSha256: createHash('sha256').update(body).digest('hex'),
    };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(
    key: string,
    ttlSeconds: number,
    disposition: 'inline' | 'attachment' = 'inline',
  ): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const nonce = randomBytes(8).toString('hex');

    const params = new URLSearchParams({
      key,
      expires: String(expires),
      nonce,
      disposition,
      signature: this.sign(key, expires, nonce, disposition),
    });

    return `${this.publicBaseUrl}/files?${params.toString()}`;
  }

  verifySignature(
    key: string,
    expires: number,
    nonce: string,
    disposition: string,
    signature: string,
  ): boolean {
    if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;

    const expected = this.sign(key, expires, nonce, disposition);
    if (expected.length !== signature.length) return false;

    // Length-independent comparison; a plain === would leak how much matched.
    let mismatch = 0;
    for (let i = 0; i < expected.length; i += 1) {
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  }

  private sign(key: string, expires: number, nonce: string, disposition: string): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${key}:${expires}:${nonce}:${disposition}`)
      .digest('hex');
  }
}
