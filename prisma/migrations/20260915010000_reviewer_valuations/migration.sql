-- Preserve inspector valuation separately from professional reviewer valuation.
CREATE TABLE IF NOT EXISTS reviewer_valuations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  inspection_id text NOT NULL UNIQUE REFERENCES inspections(id) ON DELETE CASCADE,
  reviewer_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  currency text NOT NULL DEFAULT 'RWF',
  market_value numeric(18,2),
  forced_sale_value numeric(18,2),
  replacement_cost numeric(18,2),
  rental_estimate numeric(18,2),
  comments text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS reviewer_valuations_reviewer_id_idx
  ON reviewer_valuations(reviewer_id);

CREATE INDEX IF NOT EXISTS reviewer_valuations_inspection_id_idx
  ON reviewer_valuations(inspection_id);
