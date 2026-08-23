# FilesController — one-line change

`FilesController` currently injects `LocalStorageProvider` directly to call
`verifySignature`. With the driver switch it must resolve whichever provider is
active, since both implement the same signing scheme.

Replace the constructor and the two call sites:

```ts
import { ConfigService } from '@nestjs/config';
import { BlobStorageProvider } from '../providers/storage/blob-storage.provider';
import { LocalStorageProvider } from '../providers/storage/local-storage.provider';

@Controller('files')
export class FilesController {
  private readonly signer: LocalStorageProvider | BlobStorageProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly local: LocalStorageProvider,
    private readonly blob: BlobStorageProvider,
  ) {
    // Both providers sign identically; this picks the one whose get() can
    // actually retrieve the object.
    this.signer =
      (this.config.get<string>('STORAGE_DRIVER') ?? 'local') === 'blob'
        ? this.blob
        : this.local;
  }
  // ...then use this.signer.verifySignature(...) and this.signer.get(key)
}
```
