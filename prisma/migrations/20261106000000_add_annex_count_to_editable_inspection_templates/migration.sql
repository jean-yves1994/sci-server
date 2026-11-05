-- Add the annex-count selector to templates already attached to editable inspections.
-- Existing inspections keep their template IDs and all saved values; only the
-- PROPERTY section's field definition is extended.
INSERT INTO template_fields (
  id,
  "sectionId",
  code,
  label,
  type,
  required,
  "sortOrder",
  options,
  validation,
  "helpText"
)
SELECT
  gen_random_uuid()::text,
  property_section.id,
  'ANNEX_COUNT',
  'Number of annexes',
  'NUMBER'::"FieldType",
  true,
  COALESCE((
    SELECT MAX(existing_field."sortOrder") + 1
    FROM template_fields existing_field
    WHERE existing_field."sectionId" = property_section.id
  ), 1),
  NULL,
  '{"min":0,"max":4}'::jsonb,
  'Select 0 if the property has no annexes, or the number of annexes (1–4).'
FROM template_sections property_section
JOIN inspections inspection
  ON inspection."templateId" = property_section."templateId"
WHERE property_section.code = 'PROPERTY'
  AND inspection.status IN (
    'ASSIGNED',
    'IN_PROGRESS',
    'CORRECTION_REQUESTED',
    'RESUBMITTED'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM template_fields existing_field
    WHERE existing_field."sectionId" = property_section.id
      AND existing_field.code = 'ANNEX_COUNT'
  )
GROUP BY property_section.id;

