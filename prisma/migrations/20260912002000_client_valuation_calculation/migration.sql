-- Server-authoritative valuation for the new workflow.
CREATE OR REPLACE FUNCTION sci_recalculate_client_valuation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE iid text := NEW."inspectionId"; status text; plot numeric := 0; rate numeric := 0; land numeric := 0; building numeric := 0; annex numeric := 0; total numeric := 0; fid text;
BEGIN
 IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
 SELECT COALESCE(v."valueText",v."valueNumber"::text) INTO status FROM inspection_values v JOIN template_fields f ON f.id=v."fieldId" WHERE v."inspectionId"=iid AND f.code='PROPERTY_STATUS' LIMIT 1;
 IF status='VACANT_PLOT' THEN
   SELECT COALESCE(v."valueNumber",0) INTO plot FROM inspection_values v JOIN template_fields f ON f.id=v."fieldId" WHERE v."inspectionId"=iid AND f.code='PLOT_SIZE_SQM' LIMIT 1;
   SELECT COALESCE(v."valueNumber",0) INTO rate FROM inspection_values v JOIN template_fields f ON f.id=v."fieldId" WHERE v."inspectionId"=iid AND f.code='LAND_UNIT_RATE' LIMIT 1;
   land:=plot*rate;
   SELECT f.id INTO fid FROM template_fields f JOIN template_sections s ON s.id=f."sectionId" WHERE s."templateId"=(SELECT "templateId" FROM inspections WHERE id=iid) AND f.code='LAND_ESTIMATED_VALUE' LIMIT 1;
   IF fid IS NOT NULL THEN INSERT INTO inspection_values(id,"inspectionId","fieldId","valueNumber") VALUES(gen_random_uuid()::text,iid,fid,land) ON CONFLICT ("inspectionId","fieldId") DO UPDATE SET "valueNumber"=EXCLUDED."valueNumber","valueText"=NULL,"valueJson"=NULL,"valueBool"=NULL,"valueDate"=NULL; END IF;
   INSERT INTO inspection_valuations(id,"inspectionId",currency,"marketValue",comments,"createdAt","updatedAt") VALUES(gen_random_uuid()::text,iid,'RWF',land,'Calculated from plot size × land unit rate.',now(),now()) ON CONFLICT ("inspectionId") DO UPDATE SET "marketValue"=EXCLUDED."marketValue",currency='RWF',comments=EXCLUDED.comments,"updatedAt"=now();
 ELSIF status='IMPROVED' THEN
   SELECT COALESCE(v."valueNumber",0) INTO land FROM inspection_values v JOIN template_fields f ON f.id=v."fieldId" WHERE v."inspectionId"=iid AND f.code='IMPROVED_LAND_VALUE' LIMIT 1;
   SELECT COALESCE(v."valueNumber",0) INTO building FROM inspection_values v JOIN template_fields f ON f.id=v."fieldId" WHERE v."inspectionId"=iid AND f.code='MAIN_BUILDING_VALUE' LIMIT 1;
   SELECT COALESCE(SUM(v."valueNumber"),0) INTO annex FROM inspection_values v JOIN template_fields f ON f.id=v."fieldId" WHERE v."inspectionId"=iid AND f.code LIKE 'ANNEX_%_VALUE';
   total:=land+building+annex;
   SELECT f.id INTO fid FROM template_fields f JOIN template_sections s ON s.id=f."sectionId" WHERE s."templateId"=(SELECT "templateId" FROM inspections WHERE id=iid) AND f.code='IMPROVED_TOTAL_VALUE' LIMIT 1;
   IF fid IS NOT NULL THEN INSERT INTO inspection_values(id,"inspectionId","fieldId","valueNumber") VALUES(gen_random_uuid()::text,iid,fid,total) ON CONFLICT ("inspectionId","fieldId") DO UPDATE SET "valueNumber"=EXCLUDED."valueNumber","valueText"=NULL,"valueJson"=NULL,"valueBool"=NULL,"valueDate"=NULL; END IF;
   INSERT INTO inspection_valuations(id,"inspectionId",currency,"marketValue",comments,"createdAt","updatedAt") VALUES(gen_random_uuid()::text,iid,'RWF',total,'Calculated as land + main building + annex values.',now(),now()) ON CONFLICT ("inspectionId") DO UPDATE SET "marketValue"=EXCLUDED."marketValue",currency='RWF',comments=EXCLUDED.comments,"updatedAt"=now();
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sci_client_valuation_recalculate ON inspection_values;
CREATE TRIGGER sci_client_valuation_recalculate AFTER INSERT OR UPDATE OF "valueText","valueNumber","valueBool","valueDate","valueJson" ON inspection_values FOR EACH ROW EXECUTE FUNCTION sci_recalculate_client_valuation();
