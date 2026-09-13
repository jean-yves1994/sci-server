ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS "reviewerRisk" jsonb,
  ADD COLUMN IF NOT EXISTS "reviewerConclusion" text,
  ADD COLUMN IF NOT EXISTS "reviewerAdjustedAt" timestamp(3);

-- Reviewer risk is JSON so Real Covenants can add risk categories without a
-- schema migration. The API validates LOW/MEDIUM/HIGH levels.