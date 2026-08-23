import { Global, Module } from '@nestjs/common';
import { LocalStorageProvider } from './local-storage.provider';
import { StorageProvider } from './storage.provider';

/**
 * Storage wiring.
 *
 * Only the local provider is registered here, so the build has no dependency
 * beyond what is already installed. To add object storage, run the installer
 * with --blob: it brings in BlobStorageProvider and replaces this file with a
 * version that selects between them on STORAGE_DRIVER.
 *
 * `useExisting` rather than `useClass` so both tokens resolve to one instance —
 * two instances would each hold their own signing state.
 */
@Global()
@Module({
  providers: [
    LocalStorageProvider,
    { provide: StorageProvider, useExisting: LocalStorageProvider },
  ],
  exports: [StorageProvider, LocalStorageProvider],
})
export class StorageModule {}
