CREATE TABLE "rwanda_locations" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "parent_code" TEXT,
  CONSTRAINT "rwanda_locations_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "rwanda_locations_level_parent_code_name_idx"
  ON "rwanda_locations"("level", "parent_code", "name");
