-- MIGRATION 003: Add verification_source and verified_at columns to human_reviews
-- These columns make the distinction between manual admin decisions and
-- automated/scan-derived statuses explicit and queryable.
-- All existing rows are auto-populated with DEFAULT values (no data loss).

ALTER TABLE public.human_reviews
  ADD COLUMN IF NOT EXISTS verification_source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ DEFAULT now();

-- Backfill any existing rows that predate this migration
UPDATE public.human_reviews
  SET
    verification_source = 'manual',
    verified_at = COALESCE(updated_at, created_at, now())
  WHERE verification_source IS NULL OR verified_at IS NULL;

COMMENT ON COLUMN public.human_reviews.verification_source IS
  'Source of this human decision: ''manual'' (admin clicked Mark Complete / Keep Missing)';
COMMENT ON COLUMN public.human_reviews.verified_at IS
  'Timestamp when the admin made this decision (distinct from row updated_at)';
