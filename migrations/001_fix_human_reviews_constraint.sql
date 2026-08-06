-- MIGRATION: Fix human_reviews unique constraint
-- PROBLEM: The database may have UNIQUE(enterprise_id, requirement_id) but the
--           canonical identity is enterprise_folder_id (Google Drive folder ID).
--           The correct constraint should be UNIQUE(enterprise_folder_id, requirement_id).
--
-- FIX: Drop old constraints, create correct one.
-- SAFE: Uses IF EXISTS, handles missing constraints gracefully.
-- RUN: Paste this into Supabase SQL Editor and execute.

-- Step 1: Drop ALL existing unique constraints on human_reviews that involve requirement_id
-- (We don't know the constraint name, so we drop any that match the pattern)
DO $$
DECLARE
    con RECORD;
BEGIN
    FOR con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'human_reviews'
          AND c.contype = 'u'
          AND EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.conrelid
                AND a.attnum = ANY(c.conkey)
                AND a.attname = 'requirement_id'
          )
    LOOP
        EXECUTE format('ALTER TABLE public.human_reviews DROP CONSTRAINT IF EXISTS %I', con.conname);
        RAISE NOTICE 'Dropped constraint: %', con.conname;
    END LOOP;
END $$;

-- Step 2: Clean up any NULL enterprise_folder_id rows
UPDATE public.human_reviews
SET enterprise_folder_id = enterprise_id
WHERE enterprise_folder_id IS NULL;

-- Step 3: Make enterprise_folder_id NOT NULL
ALTER TABLE public.human_reviews
ALTER COLUMN enterprise_folder_id SET NOT NULL;

-- Step 4: Create the correct unique constraint
ALTER TABLE public.human_reviews
ADD CONSTRAINT unique_folder_requirement UNIQUE (enterprise_folder_id, requirement_id);

-- Step 5: Clean up human_review_history NULLs for consistency
UPDATE public.human_review_history
SET enterprise_folder_id = enterprise_id
WHERE enterprise_folder_id IS NULL;

-- Verify
SELECT
    c.conname AS constraint_name,
    pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
WHERE t.relname = 'human_reviews' AND c.contype = 'u';
