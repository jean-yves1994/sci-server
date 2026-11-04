-- Remove retired inside-window fields and make annex validation conditional.
-- Historical values and field rows are retained; hidden fields are excluded
-- from both the active Inspector UI and backend completeness validation.
DO $$
DECLARE
  tpl_id text;
BEGIN
  SELECT id INTO tpl_id
  FROM inspection_templates
  WHERE code = 'STANDARD_PROPERTY' AND version = 2
  ORDER BY "createdAt" DESC
  LIMIT 1;

  IF tpl_id IS NULL THEN RETURN; END IF;

  -- Annex count is optional metadata: an omitted value means no annexes.
  -- Keep the max=4 validation so a supplied count cannot exceed four.
  UPDATE template_fields tf
  SET required = false,
      label = 'Number of annexes'
  FROM template_sections ts
  WHERE tf."sectionId" = ts.id
    AND ts."templateId" = tpl_id
    AND ts.code = 'ADDITIONAL_BUILDINGS'
    AND tf.code = 'ANNEX_COUNT';

  -- Inside-window material is not part of the SCI inspection requirements.
  UPDATE template_fields tf
  SET required = false,
      validation = COALESCE(tf.validation, '{}'::jsonb) || '{"hidden":true}'::jsonb
  FROM template_sections ts
  WHERE tf."sectionId" = ts.id
    AND ts."templateId" = tpl_id
    AND (
      (ts.code = 'MAIN_BUILDING' AND tf.code = 'BUILDING_INSIDE_WINDOW_MATERIAL')
      OR tf.code ~ '^ANNEX_[1-4]_INSIDE_WINDOW_MATERIAL$'
      OR tf.code ~ '^ANNEX_[1-4]_DOORS_WINDOWS$'
    );

  UPDATE inspection_templates SET "updatedAt" = now() WHERE id = tpl_id;
END $$;
