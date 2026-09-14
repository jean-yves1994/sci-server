-- Align STANDARD_PROPERTY v2 with the field workflow.
-- No schema changes: this evolves the inspection template only.
DO $$
DECLARE tpl_id text; sec_id text; i int; n int; visibility jsonb;
BEGIN
  SELECT id INTO tpl_id FROM inspection_templates
  WHERE code='STANDARD_PROPERTY' AND version=2
  ORDER BY "createdAt" DESC LIMIT 1;
  IF tpl_id IS NULL THEN RETURN; END IF;

  UPDATE template_fields tf SET options='["RESIDENTIAL","COMMERCIAL","INDUSTRIAL","AGRICULTURAL","MIXED_USE","OTHER"]'::jsonb
  FROM template_sections ts WHERE tf."sectionId"=ts.id AND ts."templateId"=tpl_id
    AND ts.code='MAIN_BUILDING' AND tf.code='BUILDING_USE';

  UPDATE template_fields tf SET type='SELECT', options='["RESIDENTIAL","COMMERCIAL","INDUSTRIAL","AGRICULTURAL","OTHER"]'::jsonb
  FROM template_sections ts WHERE tf."sectionId"=ts.id AND ts."templateId"=tpl_id
    AND ts.code='VACANT_LAND' AND tf.code='LAND_CURRENT_USE';

  SELECT id INTO sec_id FROM template_sections WHERE "templateId"=tpl_id AND code='EVIDENCE_DOCUMENTS' LIMIT 1;
  IF sec_id IS NULL THEN
    INSERT INTO template_sections (id,"templateId",code,name,"isAssessment","sortOrder")
    VALUES (gen_random_uuid()::text,tpl_id,'EVIDENCE_DOCUMENTS','Documents available',false,7)
    RETURNING id INTO sec_id;
  END IF;
  INSERT INTO template_fields (id,"sectionId",code,label,type,required,"sortOrder",options,validation) VALUES
    (gen_random_uuid()::text,sec_id,'DOCUMENTS_AVAILABLE','Documents available','MULTI_SELECT',false,1,'["LAND_TITLE","UPI_DOCUMENT","LEASE","BUILDING_PERMIT","BUILDING_PLANS","PREVIOUS_VALUATION","SALE_PURCHASE","OTHER","NONE"]'::jsonb,NULL),
    (gen_random_uuid()::text,sec_id,'DOCUMENT_OTHER','Other document description','TEXT',false,2,NULL,NULL)
  ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;

  FOR i IN 1..4 LOOP
    SELECT id INTO sec_id FROM template_sections WHERE "templateId"=tpl_id AND code=('ANNEX_'||i) LIMIT 1;
    IF sec_id IS NULL THEN
      INSERT INTO template_sections (id,"templateId",code,name,"isAssessment","sortOrder")
      VALUES (gen_random_uuid()::text,tpl_id,('ANNEX_'||i),('Annex '||i),false,10+i)
      RETURNING id INTO sec_id;
    END IF;
    visibility:=jsonb_build_object('all',jsonb_build_array(
      jsonb_build_object('field','PROPERTY_STATUS','equals','IMPROVED'),
      jsonb_build_object('field','ANNEX_COUNT','min',i)
    ));
    n:=0;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_USE','Building use','SELECT',true,n,'["RESIDENTIAL","COMMERCIAL","INDUSTRIAL","AGRICULTURAL","MIXED_USE","OTHER"]'::jsonb,jsonb_build_object('visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_FOOTPRINT_SQM','Building footprint (m²)','NUMBER',true,n,NULL,jsonb_build_object('min',0.01,'max',1000000,'visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_FLOORS','Number of floors','NUMBER',true,n,NULL,jsonb_build_object('min',1,'max',200,'visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_TOTAL_AREA_SQM','Approximate total floor area (m²)','NUMBER',true,n,NULL,jsonb_build_object('min',0.01,'max',5000000,'visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_FOUNDATION','Foundation material','SELECT',true,n,'["STONE","CONCRETE","REINFORCED_CONCRETE","OTHER"]'::jsonb,jsonb_build_object('visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_WALL','Wall material','SELECT',true,n,'["BRICK","BLOCK","STONE","CONCRETE","OTHER"]'::jsonb,jsonb_build_object('visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_ROOF','Roof material','SELECT',true,n,'["TILES","IRON_SHEETS","CONCRETE","OTHER"]'::jsonb,jsonb_build_object('visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_FLOOR','Floor material','SELECT',true,n,'["TILES","CONCRETE","WOOD","EARTH","OTHER"]'::jsonb,jsonb_build_object('visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_DOORS_WINDOWS','Doors / windows','SELECT',true,n,'["WOOD","METAL","ALUMINIUM","OTHER"]'::jsonb,jsonb_build_object('visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_CONDITION','Building condition','SELECT',true,n,'["EXCELLENT","GOOD","FAIR","POOR","VERY_POOR"]'::jsonb,jsonb_build_object('visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    n:=n+1; INSERT INTO template_fields VALUES (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_REMARKS','General description / remarks','TEXTAREA',false,n,NULL,jsonb_build_object('visibleWhen',visibility)) ON CONFLICT ("sectionId",code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
  END LOOP;
  UPDATE inspection_templates SET "updatedAt"=now() WHERE id=tpl_id;
END $$;
