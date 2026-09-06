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
 * its own signed /files endpoint, where authorization and download auditing
 * can be enforced.
 */
@Injectable()
export class BlobStorageProvider extends StorageProvider {
  private readonly logger = new Logger(BlobStorageProvider.name);
  private readonly token: string;
  private readonly signingSecret: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    super();
    this.token = this.config.get<string>('BLOB_READ_WRITE_TOKEN') ?? '';
    this.signingSecret = this.config.get<string>('JWT_SECRET') ?? '';
    this.publicBaseUrl =
      this.config.get<string>('PUBLIC_API_URL') ?? 'https://sci-server.vercel.app/api/v1';

    if (!this.token) {
      this.logger.error(
        'BLOB_READ_WRITE_TOKEN is not set. Photo and report storage will fail. ' +
          'Create/connect a private Blob store to this project.',
      );
    }
  }

  /**
   * Keep the canonical application key unchanged. The database stores this key
   * and uses it for subsequent private Blob reads.
   */
  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
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
    try {
      const metadata = await head(key, { token: this.token });
      await del(metadata.url, { token: this.token });
    } catch {
      this.logger.debug(`Delete skipped; ${key} does not exist`);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await head(key, { token: this.token });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The returned URL points to the application's authenticated file endpoint,
   * not directly to Blob. This keeps private Blob credentials server-side and
   * ensures every download passes through the existing authorization/audit path.
   */
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
