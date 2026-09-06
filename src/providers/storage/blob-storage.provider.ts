import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { del, get, head, put } from '@vercel/blob';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { StorageProvider, StoredObject } from './storage.provider';

/**
 * Object storage backed by a private Vercel Blob store.
 *
 * Inspection photographs and generated reports are sensitive evidence, so the
 * Blob store must remain private. The application exposes files only through
 * its own signed /api/v1/files endpoint.
 */
@Injectable()
export class BlobStorageProvider extends StorageProvider {
  private readonly logger = new Logger(BlobStorageProvider.name);
  private readonly token: string;
  private readonly signingSecret: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.token = this.config.get<string>('BLOB_READ_WRITE_TOKEN')?.trim() ?? '';
    this.signingSecret = this.config.get<string>('JWT_SECRET') ?? '';
    this.publicBaseUrl = absoluteBase(
      this.config.get<string>('FILE_HOST') ??
        this.config.get<string>('API_URL') ??
        this.config.get<string>('PUBLIC_API_URL'),
    );
  }

  /** Called by StorageModule for the selected storage driver. */
  assertConfigured(): void {
    if (!this.token) {
      throw new Error(
        'BLOB_READ_WRITE_TOKEN is not set. Connect the Vercel Blob store to the Production deployment and redeploy.',
      );
    }
    if (!this.signingSecret) {
      throw new Error('JWT_SECRET is not set; signed file URLs cannot be issued.');
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    this.assertConfigured();

    await put(key, body, {
      access: 'private',
      token: this.token,
      addRandomSuffix: false,
      contentType,
    });

    return {
      key,
      sizeBytes: body.byteLength,
      checksumSha256: createHash('sha256').update(body).digest('hex'),
    };
  }

  async get(key: string): Promise<Buffer> {
    this.assertConfigured();

    const result = await get(key, {
      access: 'private',
      token: this.token,
    });

    if (!result) {
      throw new Error(`Blob not found: ${key}`);
    }

    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    this.assertConfigured();

    try {
      const metadata = await head(key, { token: this.token });
      await del(metadata.url, { token: this.token });
    } catch {
      this.logger.debug(`Delete skipped; ${key} does not exist`);
    }
  }

  async exists(key: string): Promise<boolean> {
    this.assertConfigured();

    try {
      await head(key, { token: this.token });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns an absolute application URL. The private Blob URL is never exposed
   * to the client; /api/v1/files fetches the object server-side after checking
   * the short-lived HMAC signature.
   */
  async getSignedUrl(
    key: string,
    ttlSeconds: number,
    disposition: 'inline' | 'attachment' = 'inline',
  ): Promise<string> {
    this.assertConfigured();

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

/**
 * Normalize the configured API host defensively. Accepts a full URL, a bare
 * hostname, or an existing /api/v1 base and always returns an absolute base.
 */
function absoluteBase(rawValue?: string): string {
  const raw = (rawValue ?? '').trim().replace(/\/+$/, '');

  if (!raw) {
    throw new Error(
      'FILE_HOST, API_URL, or PUBLIC_API_URL must be set so signed file URLs can be absolute.',
    );
  }

  const base = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const normalized = base.replace(/\/+$/, '');
  return /\/api\/v1$/i.test(normalized) ? normalized : `${normalized}/api/v1`;
}
