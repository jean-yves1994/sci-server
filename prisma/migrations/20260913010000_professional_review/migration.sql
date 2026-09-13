CREATE TABLE IF NOT EXISTS reviewer_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  field_code text NOT NULL,
  original_value jsonb,
  adjusted_value jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS reviewer_adjustments_inspection_created_idx ON reviewer_adjustments (inspection_id, created_at);
CREATE INDEX IF NOT EXISTS reviewer_adjustments_reviewer_idx ON reviewer_adjustments (reviewer_id);
