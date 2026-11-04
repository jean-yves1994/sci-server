-- Retire inside-window material and stop reporting the annex count as a missing field.
-- Annex door/window fields remain required and are already visible only when
-- PROPERTY_STATUS=IMPROVED and ANNEX_COUNT is at least their annex number.
UPDATE template_fields tf
SET required = false,
    validation = COALESCE(tf.validation, '{}'::jsonb) || '{"hidden":true}'::jsonb
FROM template_sections ts
JOIN inspection_templates it ON it.id = ts."templateId"
WHERE tf."sectionId" = ts.id
  AND it.code = 'STANDARD_PROPERTY'
  AND it.version = 2
  AND (
    (ts.code = 'MAIN_BUILDING' AND tf.code = 'BUILDING_INSIDE_WINDOW_MATERIAL')
    OR tf.code ~ '^ANNEX_[1-4]_INSIDE_WINDOW_MATERIAL$'
  );

UPDATE template_fields tf
SET required = false
FROM template_sections ts
JOIN inspection_templates it ON it.id = ts."templateId"
WHERE tf."sectionId" = ts.id
  AND it.code = 'STANDARD_PROPERTY'
  AND it.version = 2
  AND ts.code = 'ADDITIONAL_BUILDINGS'
  AND tf.code = 'ANNEX_COUNT';
