-- Backfill ANNEX_COUNT for every template that contains a Main Building
-- section, not only the active default template. This also supports existing
-- inspections that remain attached to older template versions.
DO $$
DECLARE
  property_section RECORD;
BEGIN
  FOR property_section IN
    SELECT property.id
    FROM template_sections property
    WHERE property.code = 'PROPERTY'
      AND EXISTS (
        SELECT 1
        FROM template_sections main_building
        WHERE main_building."templateId" = property."templateId"
          AND main_building.code = 'MAIN_BUILDING'
      )
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
