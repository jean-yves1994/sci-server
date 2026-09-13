-- Professional reviewer adjustments.
-- SCI business IDs are TEXT/CUID values, not PostgreSQL UUIDs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS reviewer_adjustments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  inspection_id text NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  reviewer_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  field_code text NOT NULL,
  original_value jsonb,
  adjusted_value jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS reviewer_adjustments_inspection_created_idx
  ON reviewer_adjustments (inspection_id, created_at);
CREATE INDEX IF NOT EXISTS reviewer_adjustments_reviewer_idx
  ON reviewer_adjustments (reviewer_id);
