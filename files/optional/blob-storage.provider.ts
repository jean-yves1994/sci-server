import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { del, head, put } from '@vercel/blob';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { StorageProvider, StoredObject } from './storage.provider';

/**
 * Object storage backed by Vercel Blob.
 *
 * Required on any serverless host, where the filesystem is ephemeral: writes
 * during one invocation are gone by the next, so inspection photographs and
 * generated PDFs would disappear while the API kept returning 200. Since those
 * photographs are the evidence a lending decision rests on, that is the worst
 * available failure mode.
 *
 * The signing scheme is deliberately identical to LocalStorageProvider, so the
 * URL still points at the application's own /files endpoint rather than at a
 * Blob URL. Authorisation and the download audit record both live in that
 * endpoint; handing out Blob URLs would let a report be read without being
 * logged.
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
      // Failing loudly at boot beats discovering this on the first upload,
      // when an inspector is standing at a property with a full memory card.
      this.logger.error(
        'BLOB_READ_WRITE_TOKEN is not set. Photo and report storage will fail. ' +
          'Create a Blob store in the Vercel dashboard and connect it to this project.',
      );
    }
  }

  /**
   * addRandomSuffix is false deliberately: the database already holds
   * `storageKey` as the canonical reference, and letting Blob rewrite the
   * pathname would break every existing row. Application-generated keys embed a
   * content hash, so collisions are not a concern.
   */
  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await put(key, body, {
      access: 'public',
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
    const metadata = await head(key, { token: this.token });
    const response = await fetch(metadata.url);

    if (!response.ok) {
      throw new Error(`Blob fetch failed for ${key}: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    // del() takes a URL rather than a pathname, so metadata comes first.
    // A missing object is treated as already deleted.
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
