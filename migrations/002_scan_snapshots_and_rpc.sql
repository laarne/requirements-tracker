-- MIGRATION 002: True Atomic Scan Snapshots & PostgreSQL RPC Commit Transaction
-- Enforces true single-statement / single-function transaction commit in Supabase.
-- Automatically rolls back all database mutations if any part of the commit fails.

ALTER TABLE public.scan_jobs ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE public.scan_jobs ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE public.scan_jobs ADD COLUMN IF NOT EXISTS error_code TEXT;

ALTER TABLE public.scan_results ADD COLUMN IF NOT EXISTS scan_run_id TEXT;

-- Create PostgreSQL RPC Function for True Atomic Commit
CREATE OR REPLACE FUNCTION public.commit_scan_snapshot(
    p_job_id UUID,
    p_scan_results JSONB,
    p_folders_found INT,
    p_files_processed INT,
    p_results_saved INT
) RETURNS JSONB AS $$
DECLARE
    item JSONB;
BEGIN
    -- Inside PL/pgSQL function block, execution is inherently 100% transactional.
    -- If any row insert/update throws an error, PostgreSQL automatically rolls back everything!

    FOR item IN SELECT * FROM jsonb_array_elements(p_scan_results)
    LOOP
        INSERT INTO public.scan_results (
            enterprise_folder_id,
            enterprise_id,
            enterprise_name,
            applicant_type,
            requirement_id,
            file_id,
            file_name,
            automated_status,
            confidence,
            document_type,
            drive_url,
            matched_files,
            scanned_at,
            updated_at
        ) VALUES (
            item->>'enterprise_folder_id',
            item->>'enterprise_id',
            item->>'enterprise_name',
            COALESCE(item->>'applicant_type', 'INDIVIDUAL'),
            item->>'requirement_id',
            COALESCE(item->>'file_id', ''),
            COALESCE(item->>'file_name', ''),
            COALESCE(item->>'automated_status', 'MISSING'),
            COALESCE((item->>'confidence')::numeric, 0.0),
            item->>'document_type',
            item->>'drive_url',
            COALESCE(item->'matched_files', '[]'::jsonb),
            now(),
            now()
        )
        ON CONFLICT (enterprise_folder_id, requirement_id)
        DO UPDATE SET
            enterprise_id = EXCLUDED.enterprise_id,
            enterprise_name = EXCLUDED.enterprise_name,
            applicant_type = EXCLUDED.applicant_type,
            file_id = EXCLUDED.file_id,
            file_name = EXCLUDED.file_name,
            automated_status = EXCLUDED.automated_status,
            confidence = EXCLUDED.confidence,
            document_type = EXCLUDED.document_type,
            drive_url = EXCLUDED.drive_url,
            matched_files = EXCLUDED.matched_files,
            scanned_at = EXCLUDED.scanned_at,
            updated_at = EXCLUDED.updated_at;
    END LOOP;

    -- Update scan_jobs status to COMPLETED
    UPDATE public.scan_jobs
    SET status = 'COMPLETED',
        completed_at = now(),
        folders_found = p_folders_found,
        files_processed = p_files_processed,
        results_saved = p_results_saved
    WHERE id = p_job_id;

    RETURN jsonb_build_object('success', true, 'results_saved', p_results_saved);
EXCEPTION WHEN OTHERS THEN
    -- Any exception triggers full transaction rollback
    RAISE EXCEPTION 'Commit snapshot failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
