-- Finalize client workflow v2 after creating the new default template.
-- Keep legacy v1 inspections intact; only clean sections belonging to v2.
DO $$
DECLARE tpl_id text;
BEGIN
  SELECT id INTO tpl_id FROM inspection_templates WHERE code = 'STANDARD_PROPERTY' AND version = 2 LIMIT 1;
  IF tpl_id IS NULL THEN RETURN; END IF;
  DELETE FROM template_sections WHERE "templateId" = tpl_id AND code IN ('PROPERTY','ACCESS','FOUNDATION','ROOF','WALLS','WINDOWS','UTILITIES','ACCESSIBILITY','SECURITY','GENERAL');
  UPDATE template_fields tf SET validation = jsonb_set(COALESCE(tf.validation, '{}'::jsonb), '{visibleWhen}', '{"field":"PROPERTY_STATUS","equals":"VACANT_PLOT"}'::jsonb, true)
   FROM template_sections ts WHERE tf."sectionId" = ts.id AND ts."templateId" = tpl_id AND ts.code = 'LAND_VALUATION' AND tf.code IN ('LAND_UNIT_RATE','LAND_ESTIMATED_VALUE');
  UPDATE template_fields tf SET validation = jsonb_set(COALESCE(tf.validation, '{}'::jsonb), '{visibleWhen}', '{"all":[{"field":"PROPERTY_STATUS","equals":"IMPROVED"},{"field":"BUILDING_USE","equals":"INDUSTRIAL"}]}'::jsonb, true)
   FROM template_sections ts WHERE tf."sectionId" = ts.id AND ts."templateId" = tpl_id AND ts.code = 'MAIN_BUILDING' AND tf.code = 'INDUSTRIAL_UNITS';
END $$;
