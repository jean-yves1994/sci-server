-- One professional-review map image per inspection.
-- The binary is stored in Vercel Blob; this table keeps only metadata and the storage key.
CREATE TABLE IF NOT EXISTS reviewer_map_images (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  inspection_id text NOT NULL UNIQUE REFERENCES inspections(id) ON DELETE CASCADE,
  reviewer_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  checksum_sha256 text NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS reviewer_map_images_reviewer_id_idx
  ON reviewer_map_images(reviewer_id);
