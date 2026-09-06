import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobStorageProvider } from './blob-storage.provider';
import { StorageProvider } from './storage.provider';

/**
 * Storage wiring.
 *
 * Vercel Blob is the production storage backend. The API runs as serverless
 * functions on Vercel, so inspection evidence must never depend on the local
 * filesystem.
 */
@Global()
@Module({
  providers: [
    BlobStorageProvider,
    { provide: StorageProvider, useExisting: BlobStorageProvider },
  ],
  exports: [StorageProvider, BlobStorageProvider],
})
export class StorageModule {
  constructor(config: ConfigService) {
    const driver = (config.get<string>('STORAGE_DRIVER') ?? 'blob').trim().toLowerCase();

    if (driver === 'local' && process.env.VERCEL) {
      throw new Error(
        'STORAGE_DRIVER=local cannot be used on Vercel: the filesystem is read-only and /tmp does not persist. Use blob or s3.',
      );
    }

    if (driver !== 'blob') {
      throw new Error(
        `Unsupported STORAGE_DRIVER="${driver}". This deployment is configured for Vercel Blob; use STORAGE_DRIVER=blob.`,
      );
    }

    if (process.env.VERCEL && !config.get<string>('BLOB_READ_WRITE_TOKEN')?.trim()) {
      throw new Error(
        'BLOB_READ_WRITE_TOKEN is not set in the Vercel environment. Connect the Blob store to the Production deployment and redeploy.',
      );
    }
  }
}
