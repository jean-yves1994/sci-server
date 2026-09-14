-- The owner/client entered when registering a property is the owner/client
-- for inspections created from that property. Keep the inspection owner as
-- an inspection-level snapshot so later property edits do not rewrite history.

-- Backfill existing inspections that have a property owner but no inspection owner.
INSERT INTO inspection_owners (
  id,
  "inspectionId",
  "fullName",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  i.id,
  p."ownerClientName",
  NOW(),
  NOW()
FROM inspections i
JOIN properties p ON p.id = i."propertyId"
LEFT JOIN inspection_owners io ON io."inspectionId" = i.id
WHERE io.id IS NULL
  AND p."ownerClientName" IS NOT NULL
  AND BTRIM(p."ownerClientName") <> '';

-- Automatically create the inspection owner whenever a new inspection is
-- created from a property that has an owner/client.
CREATE OR REPLACE FUNCTION sync_property_owner_to_inspection()
RETURNS TRIGGER AS $$
DECLARE
  property_owner TEXT;
BEGIN
  SELECT BTRIM(p."ownerClientName")
    INTO property_owner
  FROM properties p
  WHERE p.id = NEW."propertyId"
    AND p."ownerClientName" IS NOT NULL
    AND BTRIM(p."ownerClientName") <> '';

  IF property_owner IS NOT NULL THEN
    INSERT INTO inspection_owners (
      id,
      "inspectionId",
      "fullName",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      gen_random_uuid()::text,
      NEW.id,
      property_owner,
      NOW(),
      NOW()
    )
    ON CONFLICT ("inspectionId") DO NOTHING;

    -- Keep the inspection's clientName aligned with the property owner when
    -- the inspection creation request did not provide a separate client name.
    IF NEW."clientName" IS NULL OR BTRIM(NEW."clientName") = '' THEN
      NEW."clientName" := property_owner;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_property_owner_to_inspection ON inspections;

CREATE TRIGGER trg_sync_property_owner_to_inspection
BEFORE INSERT ON inspections
FOR EACH ROW
EXECUTE FUNCTION sync_property_owner_to_inspection();
