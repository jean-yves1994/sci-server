import { Global, Module } from '@nestjs/common';
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
export class StorageModule {}
