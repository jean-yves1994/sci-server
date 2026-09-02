-- Add basic property-registration fields.
-- Existing property columns are intentionally retained for backward compatibility;
-- detailed inspection information will be captured by the Inspection model.

ALTER TABLE "properties"
  ADD COLUMN IF NOT EXISTS "name" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "ownerClientName" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "province" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "district" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "sector" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "cell" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "villageStreet" VARCHAR(150);

CREATE INDEX IF NOT EXISTS "properties_ownerClientName_idx"
  ON "properties"("ownerClientName");

-- These fields are no longer part of basic property registration.
-- Keep the columns nullable so existing records remain readable and existing
-- deployments can migrate without losing data.
ALTER TABLE "properties"
  ALTER COLUMN "addressLine" DROP NOT NULL;
