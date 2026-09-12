-- Client inspection workflow v2.
-- GPS remains unchanged; this migration only changes the template/schema used by new inspections.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  org_id uuid;
  tpl_id uuid;
  sec_id uuid;
  s jsonb;
  f jsonb;
  n int;
BEGIN
  SELECT id INTO org_id FROM organizations WHERE code = 'SCI-RW' LIMIT 1;
  IF org_id IS NULL THEN RETURN; END IF;

  UPDATE inspection_templates SET is_default = false WHERE organization_id = org_id;
  SELECT id INTO tpl_id FROM inspection_templates
    WHERE organization_id = org_id AND code = 'STANDARD_PROPERTY' AND version = 2 LIMIT 1;
  IF tpl_id IS NULL THEN
    INSERT INTO inspection_templates (id, organization_id, code, name, description, version, is_default, status, "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), org_id, 'STANDARD_PROPERTY', 'Standard property inspection',
      'Client workflow with conditional vacant/improved property data, valuation and evidence.', 2, true, 'ACTIVE', now(), now())
    RETURNING id INTO tpl_id;
  ELSE
    UPDATE inspection_templates SET is_default=true, status='ACTIVE', "updatedAt"=now() WHERE id=tpl_id;
  END IF;

  FOR s IN SELECT * FROM jsonb_array_elements('[
    {"code":"CLASSIFICATION","name":"Property classification","order":1,"fields":[
      {"code":"PROPERTY_USE","label":"Property use","type":"SELECT","required":true,"options":[{"value":"RESIDENTIAL","label":"Residential"},{"value":"COMMERCIAL","label":"Commercial"},{"value":"INDUSTRIAL","label":"Industrial"},{"value":"AGRICULTURAL","label":"Agricultural"},{"value":"OTHER","label":"Other"}]},
      {"code":"PROPERTY_STATUS","label":"Property status","type":"SELECT","required":true,"options":[{"value":"VACANT_PLOT","label":"Vacant Plot"},{"value":"IMPROVED","label":"Property with Improvement"}]}
    ]},
    {"code":"VACANT_LAND","name":"Vacant plot details","order":2,"fields":[
      {"code":"PLOT_SIZE_SQM","label":"Plot size (m²)","type":"NUMBER","required":true,"validation":{"min":0.01,"max":1000000,"visibleWhen":{"field":"PROPERTY_STATUS","equals":"VACANT_PLOT"}}},
      {"code":"LAND_CURRENT_USE","label":"Current use","type":"TEXT","required":true,"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"VACANT_PLOT"}}},
      {"code":"LAND_TERRAIN","label":"Terrain","type":"SELECT","required":true,"options":["FLAT","SLOPING","STEEP"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"VACANT_PLOT"}}},
      {"code":"LAND_SHAPE","label":"Shape","type":"SELECT","required":true,"options":["REGULAR","IRREGULAR"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"VACANT_PLOT"}}},
      {"code":"LAND_ACCESSIBILITY","label":"Accessibility","type":"SELECT","required":true,"options":["GOOD","FAIR","POOR"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"VACANT_PLOT"}}},
      {"code":"LAND_ROAD_ACCESS","label":"Road access","type":"BOOLEAN","required":true,"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"VACANT_PLOT"}}},
      {"code":"LAND_UTILITIES","label":"Utilities","type":"MULTI_SELECT","required":true,"options":["ELECTRICITY","WATER","NONE","OTHER"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"VACANT_PLOT"}}},
      {"code":"LAND_DEVELOPMENT","label":"Surrounding development","type":"SELECT","required":true,"options":["DEVELOPED","DEVELOPING","RURAL"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"VACANT_PLOT"}}},
      {"code":"LAND_REMARKS","label":"Remarks","type":"TEXTAREA","required":false,"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"VACANT_PLOT"}}}
    ]},
    {"code":"MAIN_BUILDING","name":"Main building","order":3,"fields":[
      {"code":"BUILDING_USE","label":"Building use","type":"SELECT","required":true,"options":["RESIDENTIAL","COMMERCIAL","INDUSTRIAL","AGRICULTURAL","OTHER"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"BUILDING_FOOTPRINT_SQM","label":"Building footprint (m²)","type":"NUMBER","required":true,"validation":{"min":0.01,"max":1000000,"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"BUILDING_FLOORS","label":"Number of floors","type":"NUMBER","required":true,"validation":{"min":1,"max":200,"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"BUILDING_TOTAL_AREA_SQM","label":"Total floor area (m²)","type":"NUMBER","required":true,"validation":{"min":0.01,"max":5000000,"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"RES_BEDROOMS","label":"Bedrooms","type":"NUMBER","required":false,"validation":{"visibleWhen":{"all":[{"field":"PROPERTY_STATUS","equals":"IMPROVED"},{"field":"BUILDING_USE","equals":"RESIDENTIAL"}]}}},
      {"code":"RES_BATHROOMS","label":"Bathrooms","type":"NUMBER","required":false,"validation":{"visibleWhen":{"all":[{"field":"PROPERTY_STATUS","equals":"IMPROVED"},{"field":"BUILDING_USE","equals":"RESIDENTIAL"}]}}},
      {"code":"RES_KITCHENS","label":"Kitchens","type":"NUMBER","required":false,"validation":{"visibleWhen":{"all":[{"field":"PROPERTY_STATUS","equals":"IMPROVED"},{"field":"BUILDING_USE","equals":"RESIDENTIAL"}]}}},
      {"code":"RES_LIVING_ROOMS","label":"Living rooms","type":"NUMBER","required":false,"validation":{"visibleWhen":{"all":[{"field":"PROPERTY_STATUS","equals":"IMPROVED"},{"field":"BUILDING_USE","equals":"RESIDENTIAL"}]}}},
      {"code":"COMM_SHOPS","label":"Shops / business units","type":"NUMBER","required":false,"validation":{"visibleWhen":{"all":[{"field":"PROPERTY_STATUS","equals":"IMPROVED"},{"field":"BUILDING_USE","equals":"COMMERCIAL"}]}}},
      {"code":"COMM_OFFICES","label":"Offices","type":"NUMBER","required":false,"validation":{"visibleWhen":{"all":[{"field":"PROPERTY_STATUS","equals":"IMPROVED"},{"field":"BUILDING_USE","equals":"COMMERCIAL"}]}}},
      {"code":"INDUSTRIAL_UNITS","label":"Industrial units / bays","type":"NUMBER","required":false,"validation":{"all":[{"field":"PROPERTY_STATUS","equals":"IMPROVED"},{"field":"BUILDING_USE","equals":"INDUSTRIAL"}]}},
      {"code":"AGRI_FACILITIES","label":"Agricultural facilities","type":"TEXT","required":false,"validation":{"visibleWhen":{"all":[{"field":"PROPERTY_STATUS","equals":"IMPROVED"},{"field":"BUILDING_USE","equals":"AGRICULTURAL"}]}}},
      {"code":"BUILDING_FOUNDATION_MATERIAL","label":"Foundation material","type":"SELECT","required":true,"options":["STONE","CONCRETE","REINFORCED_CONCRETE","OTHER"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"BUILDING_WALL_MATERIAL","label":"Wall material","type":"SELECT","required":true,"options":["BRICK","BLOCK","STONE","CONCRETE","OTHER"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"BUILDING_ROOF_MATERIAL","label":"Roof material","type":"SELECT","required":true,"options":["TILES","IRON_SHEETS","CONCRETE","OTHER"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"BUILDING_FLOOR_MATERIAL","label":"Floor material","type":"SELECT","required":true,"options":["TILES","CONCRETE","WOOD","EARTH","OTHER"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"BUILDING_DOOR_MATERIAL","label":"Door material","type":"SELECT","required":true,"options":["WOOD","METAL","ALUMINIUM","OTHER"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"BUILDING_WINDOW_MATERIAL","label":"Window material","type":"SELECT","required":true,"options":["GLASS_ALUMINIUM","WOOD","METAL","OTHER"],"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"BUILDING_REMARKS","label":"Remarks","type":"TEXTAREA","required":false,"validation":{"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}}
    ]},
    {"code":"ADDITIONAL_BUILDINGS","name":"Additional buildings / annexes","order":4,"fields":[
      {"code":"ANNEX_COUNT","label":"Number of annexes (maximum 4)","type":"NUMBER","required":true,"validation":{"min":0,"max":4,"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}}
    ]},
    {"code":"LAND_VALUATION","name":"Land valuation","order":5,"fields":[
      {"code":"LAND_UNIT_RATE","label":"Land unit rate (RWF / m²)","type":"CURRENCY","required":true,"validation":{"min":0}},
      {"code":"LAND_ESTIMATED_VALUE","label":"Estimated land value","type":"CURRENCY","required":true,"validation":{"min":0}}
    ]},
    {"code":"IMPROVED_VALUATION","name":"Improved property valuation","order":6,"fields":[
      {"code":"IMPROVED_LAND_VALUE","label":"Land value","type":"CURRENCY","required":true,"validation":{"min":0,"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"MAIN_BUILDING_VALUE","label":"Main building value","type":"CURRENCY","required":true,"validation":{"min":0,"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"ANNEX_TOTAL_VALUE","label":"Annexes total value","type":"CURRENCY","required":false,"validation":{"min":0,"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}},
      {"code":"IMPROVED_TOTAL_VALUE","label":"Total estimated value","type":"CURRENCY","required":true,"validation":{"min":0,"visibleWhen":{"field":"PROPERTY_STATUS","equals":"IMPROVED"}}}
    ]}
  ]'::jsonb) LOOP
    INSERT INTO template_sections (id, template_id, code, name, "isAssessment", "sortOrder")
      VALUES (gen_random_uuid(), tpl_id, s->>'code', s->>'name', false, (s->>'order')::int)
      ON CONFLICT (template_id, code) DO UPDATE SET name=EXCLUDED.name, "sortOrder"=EXCLUDED."sortOrder"
      RETURNING id INTO sec_id;
    n := 0;
    FOR f IN SELECT * FROM jsonb_array_elements(COALESCE(s->'fields','[]'::jsonb)) LOOP
      n := n + 1;
      INSERT INTO template_fields (id, section_id, code, label, type, required, "sortOrder", options, validation)
      VALUES (gen_random_uuid(), sec_id, f->>'code', f->>'label', (f->>'type')::"FieldType", COALESCE((f->>'required')::boolean,false), n,
        CASE WHEN jsonb_typeof(f->'options')='array' THEN f->'options' ELSE NULL END,
        CASE WHEN f ? 'validation' THEN f->'validation' ELSE NULL END)
      ON CONFLICT (section_id, code) DO UPDATE SET label=EXCLUDED.label,type=EXCLUDED.type,required=EXCLUDED.required,"sortOrder"=EXCLUDED."sortOrder",options=EXCLUDED.options,validation=EXCLUDED.validation;
    END LOOP;
  END LOOP;

  DELETE FROM template_photo_rules WHERE template_id = tpl_id;
  INSERT INTO template_photo_rules (id, template_id, category, "minCount", required, description) VALUES
    (gen_random_uuid(),tpl_id,'FRONT_VIEW',1,true,'Property frontage / access'),
    (gen_random_uuid(),tpl_id,'SURROUNDINGS',1,true,'Plot or property surroundings'),
    (gen_random_uuid(),tpl_id,'ROAD_ACCESS',1,true,'Road access'),
    (gen_random_uuid(),tpl_id,'INTERIOR',1,false,'Interior / main building'),
    (gen_random_uuid(),tpl_id,'ROOF',1,false,'Roof'),
    (gen_random_uuid(),tpl_id,'DOCUMENT',1,false,'Land title / UPI / lease document'),
    (gen_random_uuid(),tpl_id,'OTHER',1,false,'Other evidence');
END $$;
