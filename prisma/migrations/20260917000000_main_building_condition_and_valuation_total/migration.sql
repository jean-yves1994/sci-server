-- Add the missing main-building condition field to STANDARD_PROPERTY v2.
DO $$
DECLARE
  tpl_id text;
  sec_id text;
BEGIN
  SELECT id INTO tpl_id
  FROM inspection_templates
  WHERE code = 'STANDARD_PROPERTY' AND version = 2
  ORDER BY "createdAt" DESC
  LIMIT 1;

  IF tpl_id IS NULL THEN RETURN; END IF;

  SELECT id INTO sec_id
  FROM template_sections
  WHERE "templateId" = tpl_id AND code = 'MAIN_BUILDING'
  LIMIT 1;

  IF sec_id IS NULL THEN RETURN; END IF;

  INSERT INTO template_fields
    (id, "sectionId", code, label, type, required, "sortOrder", options, validation)
  VALUES
    (
      gen_random_uuid()::text,
      sec_id,
      'BUILDING_CONDITION',
      'Building condition',
      'SELECT',
      true,
      19,
      '["EXCELLENT","GOOD","FAIR","POOR","CRITICAL"]'::jsonb,
      '{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}'::jsonb
    )
  ON CONFLICT ("sectionId", code) DO UPDATE SET
    label = EXCLUDED.label,
    type = EXCLUDED.type,
    required = EXCLUDED.required,
    "sortOrder" = EXCLUDED."sortOrder",
    options = EXCLUDED.options,
    validation = EXCLUDED.validation;
END $$;

-- Keep improved-property valuation totals authoritative and server-calculated.
-- annex total = Annex 1 + Annex 2 + Annex 3 + Annex 4
-- total estimated value = land value + main building value + annex total
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
  total_field_id text;
  annex_sum numeric := 0;
  land_value numeric := 0;
  main_value numeric := 0;
  current_value numeric := 0;
  i integer;
  annex_field_id text;
BEGIN
  SELECT "templateId" INTO template_id
  FROM inspections
  WHERE id = NEW."inspectionId";

  IF template_id IS NULL THEN RETURN NEW; END IF;

  SELECT code INTO changed_field_code
  FROM template_fields
  WHERE id = NEW."fieldId";

  -- Generated totals are written by this function itself. Do not recurse into
  -- the same calculation when those rows are inserted/updated.
  IF changed_field_code IN ('ANNEX_TOTAL_VALUE', 'IMPROVED_TOTAL_VALUE') THEN
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

  FOR i IN 1..4 LOOP
    SELECT tf.id INTO annex_field_id
    FROM template_fields tf
    JOIN template_sections ts ON ts.id = tf."sectionId"
    WHERE ts."templateId" = template_id AND tf.code = 'ANNEX_' || i || '_VALUE'
    LIMIT 1;

    IF annex_field_id IS NOT NULL THEN
      SELECT COALESCE("valueNumber", 0) INTO current_value
      FROM inspection_values
      WHERE "inspectionId" = NEW."inspectionId" AND "fieldId" = annex_field_id;
      annex_sum := annex_sum + COALESCE(current_value, 0);
    END IF;
  END LOOP;

  IF annex_total_field_id IS NOT NULL THEN
    INSERT INTO inspection_values (id, "inspectionId", "fieldId", "valueNumber")
    VALUES (gen_random_uuid()::text, NEW."inspectionId", annex_total_field_id, annex_sum)
    ON CONFLICT ("inspectionId", "fieldId") DO UPDATE
      SET "valueNumber" = EXCLUDED."valueNumber",
          "valueText" = NULL,
          "valueDate" = NULL,
          "valueBool" = NULL,
          "valueJson" = NULL;
  END IF;

  IF total_field_id IS NOT NULL THEN
    INSERT INTO inspection_values (id, "inspectionId", "fieldId", "valueNumber")
    VALUES (
      gen_random_uuid()::text,
      NEW."inspectionId",
      total_field_id,
      land_value + main_value + annex_sum
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

-- Do not use PostgreSQL's UPDATE OF column-list here. The production database
-- uses Prisma's camelCase column names and an earlier deployment reported the
-- unquoted snake_case value_number while parsing the trigger. Firing on every
-- INSERT/UPDATE is safe because the function exits for generated total rows.
DROP TRIGGER IF EXISTS trg_calculate_inspection_valuation_totals ON inspection_values;
CREATE TRIGGER trg_calculate_inspection_valuation_totals
AFTER INSERT OR UPDATE ON inspection_values
FOR EACH ROW
WHEN (NEW."fieldId" IS NOT NULL)
EXECUTE FUNCTION calculate_inspection_valuation_totals();