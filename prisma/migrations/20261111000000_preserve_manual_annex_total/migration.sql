-- Annex total is an inspector-entered value when one or more annexes exist.
-- Preserve it when other valuation fields change, and recalculate only the
-- overall improved-property total from land + main building + entered annex total.
CREATE OR REPLACE FUNCTION calculate_inspection_valuation_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  template_id text;
  changed_field_code text;
  land_field_id text;
  main_field_id text;
  annex_total_field_id text;
  annex_count_field_id text;
  total_field_id text;
  annex_count integer := 0;
  annex_total numeric := 0;
  land_value numeric := 0;
  main_value numeric := 0;
BEGIN
  SELECT "templateId" INTO template_id
  FROM inspections
  WHERE id = NEW."inspectionId";

  IF template_id IS NULL THEN RETURN NEW; END IF;

  SELECT code INTO changed_field_code
  FROM template_fields
  WHERE id = NEW."fieldId";

  -- Avoid recursion only for the generated overall total. A change to the
  -- manually entered annex total must flow through to the overall total.
  IF changed_field_code = 'IMPROVED_TOTAL_VALUE' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM inspection_values iv
    JOIN template_fields tf ON tf.id = iv."fieldId"
    WHERE iv."inspectionId" = NEW."inspectionId"
      AND tf.code = 'PROPERTY_STATUS'
      AND UPPER(COALESCE(iv."valueText", '')) = 'IMPROVED'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT tf.id INTO land_field_id
  FROM template_fields tf
  JOIN template_sections ts ON ts.id = tf."sectionId"
  WHERE ts."templateId" = template_id AND tf.code = 'IMPROVED_LAND_VALUE'
  LIMIT 1;

  SELECT tf.id INTO main_field_id
  FROM template_fields tf
  JOIN template_sections ts ON ts.id = tf."sectionId"
  WHERE ts."templateId" = template_id AND tf.code = 'MAIN_BUILDING_VALUE'
  LIMIT 1;

  SELECT tf.id INTO annex_total_field_id
  FROM template_fields tf
  JOIN template_sections ts ON ts.id = tf."sectionId"
  WHERE ts."templateId" = template_id AND tf.code = 'ANNEX_TOTAL_VALUE'
  LIMIT 1;

  SELECT tf.id INTO annex_count_field_id
  FROM template_fields tf
  JOIN template_sections ts ON ts.id = tf."sectionId"
  WHERE ts."templateId" = template_id AND tf.code = 'ANNEX_COUNT'
  LIMIT 1;

  SELECT tf.id INTO total_field_id
  FROM template_fields tf
  JOIN template_sections ts ON ts.id = tf."sectionId"
  WHERE ts."templateId" = template_id AND tf.code = 'IMPROVED_TOTAL_VALUE'
  LIMIT 1;

  IF land_field_id IS NOT NULL THEN
    SELECT COALESCE("valueNumber", 0) INTO land_value
    FROM inspection_values
    WHERE "inspectionId" = NEW."inspectionId" AND "fieldId" = land_field_id;
  END IF;

  IF main_field_id IS NOT NULL THEN
    SELECT COALESCE("valueNumber", 0) INTO main_value
    FROM inspection_values
    WHERE "inspectionId" = NEW."inspectionId" AND "fieldId" = main_field_id;
  END IF;

  IF annex_count_field_id IS NOT NULL THEN
    SELECT COALESCE("valueNumber", 0)::integer INTO annex_count
    FROM inspection_values
    WHERE "inspectionId" = NEW."inspectionId" AND "fieldId" = annex_count_field_id;
  END IF;

  IF annex_count > 0 AND annex_total_field_id IS NOT NULL THEN
    SELECT COALESCE("valueNumber", 0) INTO annex_total
    FROM inspection_values
    WHERE "inspectionId" = NEW."inspectionId" AND "fieldId" = annex_total_field_id;
  ELSE
    annex_total := 0;
  END IF;

  IF total_field_id IS NOT NULL THEN
    INSERT INTO inspection_values (id, "inspectionId", "fieldId", "valueNumber")
    VALUES (
      gen_random_uuid()::text,
      NEW."inspectionId",
      total_field_id,
      land_value + main_value + annex_total
    )
    ON CONFLICT ("inspectionId", "fieldId") DO UPDATE
      SET "valueNumber" = EXCLUDED."valueNumber",
          "valueText" = NULL,
          "valueDate" = NULL,
          "valueBool" = NULL,
          "valueJson" = NULL;
  END IF;

  RETURN NEW;
END;
$$;
