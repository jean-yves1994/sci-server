ALTER TABLE reviewer_valuations
  ADD COLUMN IF NOT EXISTS land_value DECIMAL(18,2),
  ADD COLUMN IF NOT EXISTS main_building_value DECIMAL(18,2),
  ADD COLUMN IF NOT EXISTS total_estimated_value DECIMAL(18,2);
