-- Inspector-app template refinements and client-side improved valuation.
-- Keep legacy fields for historical records, but hide them from the active form.
-- The Inspector app calculates derived valuation totals locally and sends them
-- in the same batched values save; no extra total-calculation request is needed.

DO $$
DECLARE
  tpl_id text;
  sec_id text;
  i int;
  n int;
  visibility jsonb;
  door_options jsonb := '["WOOD","METAL","ALUMINIUM","OTHER"]'::jsonb;
  window_options jsonb := '["GLASS_ALUMINIUM","WOOD","METAL","OTHER"]'::jsonb;
  floor_options jsonb := '["TILES","CONCRETE","CEMENT","WOOD","EARTH","OTHER"]'::jsonb;
BEGIN
  SELECT id INTO tpl_id
  FROM inspection_templates
  WHERE code = 'STANDARD_PROPERTY' AND version = 2
  ORDER BY "createdAt" DESC
  LIMIT 1;

  IF tpl_id IS NULL THEN RETURN; END IF;

  -- Main-building floor: retain CONCRETE and add CEMENT.
  UPDATE template_fields tf
  SET options = floor_options
  FROM template_sections ts
  WHERE tf."sectionId" = ts.id
    AND ts."templateId" = tpl_id
    AND ts.code = 'MAIN_BUILDING'
    AND tf.code = 'BUILDING_FLOOR_MATERIAL';

  SELECT id INTO sec_id
  FROM template_sections
  WHERE "templateId" = tpl_id AND code = 'MAIN_BUILDING'
  LIMIT 1;

  IF sec_id IS NOT NULL THEN
    -- Preserve old combined fields for historical data, but stop displaying
    -- them in the active form.
    UPDATE template_fields
    SET validation = jsonb_build_object('hidden', true)
    WHERE "sectionId" = sec_id
      AND code IN ('BUILDING_DOOR_MATERIAL', 'BUILDING_WINDOW_MATERIAL');

    -- Add four explicit door/window material fields.
    INSERT INTO template_fields
      (id,"sectionId",code,label,type,required,"sortOrder",options,validation)
    VALUES
      (gen_random_uuid()::text,sec_id,'BUILDING_OUTSIDE_DOOR_MATERIAL','Outside door material','SELECT',true,20,door_options,'{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}'::jsonb),
      (gen_random_uuid()::text,sec_id,'BUILDING_OUTSIDE_WINDOW_MATERIAL','Outside window material','SELECT',true,21,window_options,'{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}'::jsonb),
      (gen_random_uuid()::text,sec_id,'BUILDING_INSIDE_DOOR_MATERIAL','Inside door material','SELECT',true,22,door_options,'{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}'::jsonb),
      (gen_random_uuid()::text,sec_id,'BUILDING_INSIDE_WINDOW_MATERIAL','Inside window material','SELECT',true,23,window_options,'{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}'::jsonb)
    ON CONFLICT ("sectionId",code) DO UPDATE SET
      label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,
      "sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;

    -- Total and annex total are derived values. Mark them read-only/computed
    -- for clients that understand the metadata.
    UPDATE template_fields
    SET validation = jsonb_strip_nulls(
      COALESCE(validation,'{}'::jsonb) ||
      '{"computed":true,"readOnly":true}'::jsonb
    )
    WHERE "sectionId" = (
      SELECT id FROM template_sections
      WHERE "templateId" = tpl_id AND code = 'IMPROVED_VALUATION'
      LIMIT 1
    )
    AND code IN ('ANNEX_TOTAL_VALUE','IMPROVED_TOTAL_VALUE');
  END IF;

  -- Annexes: add CEMENT and replace the combined Doors / windows field with
  -- four explicit material selections. Legacy combined fields remain hidden.
  FOR i IN 1..4 LOOP
    SELECT id INTO sec_id
    FROM template_sections
    WHERE "templateId" = tpl_id AND code = ('ANNEX_'||i)
    LIMIT 1;

    IF sec_id IS NULL THEN CONTINUE; END IF;

    UPDATE template_fields
    SET options = floor_options
    WHERE "sectionId" = sec_id AND code = ('ANNEX_'||i||'_FLOOR');

    UPDATE template_fields
    SET validation = jsonb_build_object('hidden', true)
    WHERE "sectionId" = sec_id
      AND code = ('ANNEX_'||i||'_DOORS_WINDOWS');

    SELECT validation INTO visibility
    FROM template_fields
    WHERE "sectionId" = sec_id AND code = ('ANNEX_'||i||'_USE')
    LIMIT 1;

    IF visibility IS NULL THEN
      visibility := jsonb_build_object('visibleWhen', jsonb_build_object(
        'all', jsonb_build_array(
          jsonb_build_object('field','PROPERTY_STATUS','equals','IMPROVED'),
          jsonb_build_object('field','ANNEX_COUNT','min',i)
        )
      ));
    END IF;

    n := 0;
    n := n + 1;
    INSERT INTO template_fields
      (id,"sectionId",code,label,type,required,"sortOrder",options,validation)
    VALUES
      (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_OUTSIDE_DOOR_MATERIAL','Outside door material','SELECT',true,9,door_options,visibility)
    ON CONFLICT ("sectionId",code) DO UPDATE SET
      label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,
      "sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;

    n := n + 1;
    INSERT INTO template_fields
      (id,"sectionId",code,label,type,required,"sortOrder",options,validation)
    VALUES
      (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_OUTSIDE_WINDOW_MATERIAL','Outside window material','SELECT',true,10,window_options,visibility)
    ON CONFLICT ("sectionId",code) DO UPDATE SET
      label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,
      "sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;

    n := n + 1;
    INSERT INTO template_fields
      (id,"sectionId",code,label,type,required,"sortOrder",options,validation)
    VALUES
      (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_INSIDE_DOOR_MATERIAL','Inside door material','SELECT',true,11,door_options,visibility)
    ON CONFLICT ("sectionId",code) DO UPDATE SET
      label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,
      "sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;

    n := n + 1;
    INSERT INTO template_fields
      (id,"sectionId",code,label,type,required,"sortOrder",options,validation)
    VALUES
      (gen_random_uuid()::text,sec_id,'ANNEX_'||i||'_INSIDE_WINDOW_MATERIAL','Inside window material','SELECT',true,12,window_options,visibility)
    ON CONFLICT ("sectionId",code) DO UPDATE SET
      label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,
      "sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
  END LOOP;

  UPDATE inspection_templates SET "updatedAt" = now() WHERE id = tpl_id;
END $$;

-- Client-side calculation is now authoritative for normal Inspector saves.
-- Existing totals are retained as historical values and are overwritten by
-- the Flutter app whenever land/main-building/annex values are edited.
DROP TRIGGER IF EXISTS trg_calculate_inspection_valuation_totals ON inspection_values;
DROP FUNCTION IF EXISTS calculate_inspection_valuation_totals();
