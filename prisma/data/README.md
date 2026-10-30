# Rwanda administrative reference data

The compact dataset in `rwanda-locations.json` is derived from the MIT-licensed dataset at https://github.com/jnkindi/rwanda-locations-json (source file `locations.json`). It contains unique Province, District, Sector and Cell records only. Village records are deliberately excluded from SCI's selector dataset.

To populate a database after applying migrations:

```bash
npx ts-node -T prisma/import-rwanda-locations.ts
```

The importer is idempotent and inserts in batches. It does not touch organization-specific `administrative_divisions` or existing property records.
