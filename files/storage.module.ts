import { Global, Module } from '@nestjs/common';
import { LocalStorageProvider } from './local-storage.provider';
import { StorageProvider } from './storage.provider';

/**
 * Storage wiring.
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
