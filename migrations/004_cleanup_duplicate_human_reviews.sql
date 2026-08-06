-- MIGRATION 004: Safe duplicate human_reviews cleanup + finalStatus enforcement
-- =============================================================================
-- BACKGROUND:
-- Before the fix in commit d9080d7, setDocOverride() used the wrong conflict key:
--   onConflict: 'enterprise_id,requirement_id'  (WRONG)
-- The actual unique constraint is:
--   unique_folder_requirement: (enterprise_folder_id, requirement_id)
--
-- This means repeated Mark Complete / Keep Missing clicks on the same requirement
-- may have created DUPLICATE rows in human_reviews instead of updating the existing row.
-- The duplicates are distinguished only by created_at / updated_at timestamps.
--
-- This migration:
--   1. IDENTIFIES duplicates (safe read - no writes yet)
--   2. KEEPS the LATEST record per (enterprise_folder_id, requirement_id)
--   3. DELETES older duplicates
--   4. Does NOT touch the unique_folder_requirement constraint (already correct)
--   5. Does NOT delete any record that is the authoritative latest decision
--   6. Preserves ALL records in human_review_history (immutable audit log - never touched)
-- =============================================================================

-- STEP 0: Inspect duplicates before doing anything (run this SELECT to verify)
-- SELECT enterprise_folder_id, requirement_id, COUNT(*) as dup_count
-- FROM public.human_reviews
-- GROUP BY enterprise_folder_id, requirement_id
-- HAVING COUNT(*) > 1
-- ORDER BY dup_count DESC;

-- STEP 1: Idempotent column additions (from migration 003 - safe to re-run)
ALTER TABLE public.human_reviews
  ADD COLUMN IF NOT EXISTS verification_source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ DEFAULT now();

-- STEP 2: Backfill any NULL verification_source / verified_at from existing rows
UPDATE public.human_reviews
  SET
    verification_source = COALESCE(verification_source, 'manual'),
    verified_at = COALESCE(verified_at, updated_at, created_at, now())
  WHERE verification_source IS NULL OR verified_at IS NULL;

-- STEP 3: Safe duplicate removal
-- For each (enterprise_folder_id, requirement_id) group with >1 row:
--   Keep the row with the LATEST updated_at (most recent admin decision)
--   Delete all older rows
--
-- This is safe because:
--   - human_review_history is NEVER touched (all audit trail preserved)
--   - We keep the LATEST decision which is what the admin last intended
--   - The unique constraint prevents new duplicates going forward
DELETE FROM public.human_reviews
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      enterprise_folder_id,
      requirement_id,
      updated_at,
      created_at,
      ROW_NUMBER() OVER (
        PARTITION BY enterprise_folder_id, requirement_id
        ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
      ) AS rn
    FROM public.human_reviews
  ) ranked
  WHERE rn > 1  -- keep rn=1 (latest), delete rn>1 (older duplicates)
);

-- STEP 4: Verify cleanup (run this SELECT after migration to confirm 0 duplicates)
-- SELECT COUNT(*) as remaining_duplicates
-- FROM (
--   SELECT enterprise_folder_id, requirement_id, COUNT(*) as cnt
--   FROM public.human_reviews
--   GROUP BY enterprise_folder_id, requirement_id
--   HAVING COUNT(*) > 1
-- ) dups;
-- Expected result: 0 rows (no remaining duplicates)

-- STEP 5: Ensure the correct unique constraint exists
-- (This should already exist from the original schema, but verify idempotently)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_folder_requirement'
      AND conrelid = 'public.human_reviews'::regclass
  ) THEN
    ALTER TABLE public.human_reviews
      ADD CONSTRAINT unique_folder_requirement
      UNIQUE (enterprise_folder_id, requirement_id);
    RAISE NOTICE 'unique_folder_requirement constraint added.';
  ELSE
    RAISE NOTICE 'unique_folder_requirement constraint already exists.';
  END IF;
END $$;

-- STEP 6: Document the business rule as a DB comment
COMMENT ON TABLE public.human_reviews IS
  'Current/latest human administrator decision per enterprise + requirement.
   PRIORITY RULE: human_reviews always takes precedence over scan_results.
   finalStatus = human_reviews.human_status IF row exists, ELSE scan_results.automated_status.
   The Google Drive scanner NEVER reads or writes this table.
   Unique key: (enterprise_folder_id, requirement_id) via unique_folder_requirement constraint.';
