/**
 * Object storage abstraction.
 *
 * Photographs and PDFs never go into ordinary database columns: a few hundred
 * inspections with a dozen photos each would bloat the database, slow every
 * backup, and make ordinary queries expensive. The database stores keys and
 * metadata only.
 */
export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksumSha256: string;
}

export abstract class StorageProvider {
  abstract put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;

  abstract get(key: string): Promise<Buffer>;

  abstract delete(key: string): Promise<void>;

  abstract exists(key: string): Promise<boolean>;

  /**
   * Time-limited URL for a single object, so image and PDF traffic need not be
   * proxied through the API while access stays revocable and expiring.
   */
  abstract getSignedUrl(
    key: string,
    ttlSeconds: number,
    disposition?: 'inline' | 'attachment',
  ): Promise<string>;

  /**
   * Verifies a signature produced by getSignedUrl.
   *
   * Declared on the abstraction rather than only on the concrete classes so
   * FilesController can inject StorageProvider and stay ignorant of the driver.
   *
   * Implementations must compare in a length-independent way: a plain `===`
   * short-circuits on the first differing character and leaks, over many
   * attempts, how much of a forged signature was correct.
   */
  abstract verifySignature(
    key: string,
    expires: number,
    nonce: string,
    disposition: string,
    signature: string,
  ): boolean;
}
