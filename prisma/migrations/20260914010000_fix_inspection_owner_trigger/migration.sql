-- Fix inspection owner synchronization.
--
-- The previous trigger was BEFORE INSERT and attempted to insert into
-- inspection_owners using NEW.id. PostgreSQL has not inserted the parent
-- inspection row yet at that point, so the inspection_owners foreign key
-- correctly rejected the insert.
--
-- Replace it with an AFTER INSERT trigger so the inspection exists before
-- its inspection-level owner snapshot is created.

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

    -- If the creation request did not provide a client name, keep the
    -- inspection snapshot aligned with the property owner.
    IF NEW."clientName" IS NULL OR BTRIM(NEW."clientName") = '' THEN
      UPDATE inspections
      SET "clientName" = property_owner
      WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_property_owner_to_inspection ON inspections;

CREATE TRIGGER trg_sync_property_owner_to_inspection
AFTER INSERT ON inspections
FOR EACH ROW
EXECUTE FUNCTION sync_property_owner_to_inspection();
