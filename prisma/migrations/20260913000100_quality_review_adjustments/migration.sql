-- Reviewer adjustment compatibility table.
-- SCI IDs are TEXT/CUID values, so foreign keys must use TEXT as well.
-- This table is retained for migration-history compatibility; the current
-- professional review service uses reviewer_adjustments from the next migration.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS quality_review_adjustments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  inspection_id text NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  reviewer_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  field_code text NOT NULL,
  original_value jsonb,
  adjusted_value jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS quality_review_adjustments_inspection_idx
  ON quality_review_adjustments (inspection_id, created_at);
CREATE INDEX IF NOT EXISTS quality_review_adjustments_reviewer_idx
  ON quality_review_adjustments (reviewer_id);
