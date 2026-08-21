import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlobStorageProvider } from './blob-storage.provider';
import { LocalStorageProvider } from './local-storage.provider';
import { StorageProvider } from './storage.provider';

/**
 * Storage wiring, selected by STORAGE_DRIVER.
 *
 * Local disk suits development and any host with a persistent volume; Blob is
 * required on a serverless host, where the filesystem does not persist between
 * invocations. Both satisfy the same abstract class, so nothing downstream
 * knows which is active.
 *
 * This factory is the single place the driver is chosen. FilesController
 * injects StorageProvider rather than re-deciding, because two copies of one
 * rule eventually disagree.
 */
@Global()
@Module({
  providers: [
    LocalStorageProvider,
    BlobStorageProvider,
    {
      provide: StorageProvider,
      inject: [ConfigService, LocalStorageProvider, BlobStorageProvider],
      useFactory: (
        config: ConfigService,
        local: LocalStorageProvider,
        blob: BlobStorageProvider,
      ) => ((config.get<string>('STORAGE_DRIVER') ?? 'local') === 'blob' ? blob : local),
    },
  ],
  exports: [StorageProvider, LocalStorageProvider, BlobStorageProvider],
})
export class StorageModule {}
