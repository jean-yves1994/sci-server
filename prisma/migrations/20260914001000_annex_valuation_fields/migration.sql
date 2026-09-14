DO $$
DECLARE tpl_id text; sec_id text; i int;
BEGIN
  SELECT id INTO tpl_id FROM inspection_templates WHERE code='STANDARD_PROPERTY' AND version=2 ORDER BY "createdAt" DESC LIMIT 1;
  IF tpl_id IS NULL THEN RETURN; END IF;
  SELECT id INTO sec_id FROM template_sections WHERE "templateId"=tpl_id AND code='IMPROVED_VALUATION' LIMIT 1;
  IF sec_id IS NULL THEN RETURN; END IF;
  FOR i IN 1..4 LOOP
    INSERT INTO template_fields (id,"sectionId",code,label,type,required,"sortOrder",options,validation)
    VALUES (
      gen_random_uuid()::text, sec_id, 'ANNEX_'||i||'_VALUE', 'Annex '||i||' value', 'CURRENCY', false, 10+i,
      NULL, jsonb_build_object('min',0,'visibleWhen',jsonb_build_object('all',jsonb_build_array(
        jsonb_build_object('field','PROPERTY_STATUS','equals','IMPROVED'),
        jsonb_build_object('field','ANNEX_COUNT','min',i)
      )))
    )
    ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
  END LOOP;
END $$;
