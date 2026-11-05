-- Add a numeric annex-count selector to existing active default templates.
-- The Flutter inspector presents NUMBER fields with a bounded 0–4 dropdown.
DO $$
DECLARE
  property_section RECORD;
BEGIN
  FOR property_section IN
    SELECT ts.id
    FROM template_sections ts
    JOIN inspection_templates it ON it.id = ts."templateId"
    WHERE ts.code = 'PROPERTY'
      AND it."isDefault" = true
      AND it.status = 'ACTIVE'
  LOOP
    UPDATE template_fields
      SET "sortOrder" = "sortOrder" + 1
      WHERE "sectionId" = property_section.id
        AND "sortOrder" >= 2
        AND code <> 'ANNEX_COUNT';

    INSERT INTO template_fields (
      id, "sectionId", code, label, type, required, "sortOrder", options, validation, "helpText"
    )
    SELECT
      gen_random_uuid()::text,
      property_section.id,
      'ANNEX_COUNT',
      'Number of annexes',
      'NUMBER'::"FieldType",
      true,
      2,
      NULL,
      '{"min":0,"max":4}'::jsonb,
      'Select 0 if the property has no annexes, or the number of annexes (1–4).'
    WHERE NOT EXISTS (
      SELECT 1 FROM template_fields
      WHERE "sectionId" = property_section.id AND code = 'ANNEX_COUNT'
    );
  END LOOP;
END $$;
