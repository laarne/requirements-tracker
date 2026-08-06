-- ============================================================================
-- COMPLETE INITIAL SCHEMA MIGRATION
-- Unofficial YFC Participant Requirements Tracker
-- ============================================================================
-- This migration is IDEMPOTENT: safe to run multiple times.
-- Uses CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, etc.
-- ============================================================================

-- ============================================================================
-- TABLE 1: human_reviews
-- Stores the current/latest manual review decision per enterprise + requirement.
-- Canonical identity: enterprise_folder_id (real Google Drive folder ID).
-- UPSERT target: UNIQUE(enterprise_folder_id, requirement_id)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.human_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_folder_id TEXT NOT NULL,
    enterprise_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    file_id TEXT,
    automated_status TEXT,
    human_status TEXT NOT NULL,
    reviewer_name TEXT DEFAULT 'Operational Reviewer',
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_folder_requirement UNIQUE (enterprise_folder_id, requirement_id)
);

CREATE INDEX IF NOT EXISTS idx_human_reviews_enterprise ON public.human_reviews(enterprise_id);
CREATE INDEX IF NOT EXISTS idx_human_reviews_folder ON public.human_reviews(enterprise_folder_id);

ALTER TABLE public.human_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access" ON public.human_reviews;
DROP POLICY IF EXISTS "Allow public write access" ON public.human_reviews;

CREATE POLICY "Allow public read access" ON public.human_reviews
    FOR SELECT USING (true);

CREATE POLICY "Allow public write access" ON public.human_reviews
    FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- TABLE 2: human_review_history
-- Immutable append-only audit log of every review action.
-- NEVER update or delete rows from this table.
-- RLS: SELECT + INSERT only (no UPDATE/DELETE policies).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.human_review_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_folder_id TEXT,
    enterprise_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    file_id TEXT,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    reviewer_name TEXT DEFAULT 'Operational Reviewer',
    reviewer_email TEXT,
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_human_review_history_ent_req
    ON public.human_review_history(enterprise_id, requirement_id);
CREATE INDEX IF NOT EXISTS idx_human_review_history_folder
    ON public.human_review_history(enterprise_folder_id);

ALTER TABLE public.human_review_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read history" ON public.human_review_history;
DROP POLICY IF EXISTS "Allow public insert history" ON public.human_review_history;

CREATE POLICY "Allow public read history" ON public.human_review_history
    FOR SELECT USING (true);

CREATE POLICY "Allow public insert history" ON public.human_review_history
    FOR INSERT WITH CHECK (true);


-- ============================================================================
-- TABLE 3: scan_results
-- Automated Google Drive scanner outputs.
-- Canonical identity: enterprise_folder_id (real Google Drive folder ID).
-- UPSERT target: UNIQUE(enterprise_folder_id, requirement_id)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.scan_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_folder_id TEXT NOT NULL,
    enterprise_id TEXT NOT NULL,
    enterprise_name TEXT,
    applicant_type TEXT DEFAULT 'INDIVIDUAL',
    requirement_id TEXT NOT NULL,
    file_id TEXT,
    file_name TEXT,
    automated_status TEXT NOT NULL,
    confidence NUMERIC DEFAULT 0.0,
    document_type TEXT,
    drive_url TEXT,
    matched_files JSONB DEFAULT '[]'::jsonb,
    scanned_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_scan_folder_req UNIQUE (enterprise_folder_id, requirement_id)
);

CREATE INDEX IF NOT EXISTS idx_scan_results_folder
    ON public.scan_results(enterprise_folder_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_enterprise
    ON public.scan_results(enterprise_id);

ALTER TABLE public.scan_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read scan results" ON public.scan_results;
DROP POLICY IF EXISTS "Allow public write scan results" ON public.scan_results;

CREATE POLICY "Allow public read scan results" ON public.scan_results
    FOR SELECT USING (true);

CREATE POLICY "Allow public write scan results" ON public.scan_results
    FOR ALL USING (true) WITH CHECK (true);


-- ============================================================================
-- TABLE 4: scan_jobs
-- Scan job status tracking for dashboard UI polling and diagnostics.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.scan_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'QUEUED',
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    folders_found INTEGER DEFAULT 0,
    unique_enterprise_folders INTEGER DEFAULT 0,
    files_found INTEGER DEFAULT 0,
    files_processed INTEGER DEFAULT 0,
    files_total INTEGER DEFAULT 0,
    results_saved INTEGER DEFAULT 0,
    duplicate_records_consolidated INTEGER DEFAULT 0,
    possible_duplicates INTEGER DEFAULT 0,
    new_enterprises_found INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_status
    ON public.scan_jobs(status, created_at);

ALTER TABLE public.scan_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read scan jobs" ON public.scan_jobs;
DROP POLICY IF EXISTS "Allow public write scan jobs" ON public.scan_jobs;

CREATE POLICY "Allow public read scan jobs" ON public.scan_jobs
    FOR SELECT USING (true);

CREATE POLICY "Allow public write scan jobs" ON public.scan_jobs
    FOR ALL USING (true) WITH CHECK (true);
