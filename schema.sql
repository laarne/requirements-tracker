-- ============================================================================
-- Supabase Schema for Unofficial YFC Participant Requirements Tracker
-- Stable Enterprise Identity Model: Google Drive Folder ID = Primary Enterprise Identity
-- 1. public.human_reviews: Current/latest decision per enterprise + requirement.
-- 2. public.human_review_history: Immutable audit log of every review action.
-- 3. public.scan_results: Automated Google Drive scanner outputs keyed by enterprise_folder_id + requirement_id.
-- 4. public.scan_jobs: Online scan job status tracking for dashboard UI polling & diagnostics.
--
-- MIGRATION NOTES:
-- The canonical enterprise identity is enterprise_folder_id (Google Drive Folder ID).
-- enterprise_id (slug) is a secondary/legacy field and MUST NOT be used as a uniqueness key.
-- All NEW constraints use enterprise_folder_id as the primary identity.
-- See migrations/000_initial_schema.sql for the authoritative idempotent migration.
-- ============================================================================

-- Table 1: Current/Latest Human Review Decisions
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

CREATE POLICY "Allow public read access" ON public.human_reviews FOR SELECT USING (true);
CREATE POLICY "Allow public write access" ON public.human_reviews FOR ALL USING (true) WITH CHECK (true);


-- Table 2: Immutable Review History Log (STRICTLY READ & INSERT ONLY)
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

CREATE INDEX IF NOT EXISTS idx_human_review_history_ent_req ON public.human_review_history(enterprise_id, requirement_id);
CREATE INDEX IF NOT EXISTS idx_human_review_history_folder ON public.human_review_history(enterprise_folder_id);
ALTER TABLE public.human_review_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read history" ON public.human_review_history;
DROP POLICY IF EXISTS "Allow public insert history" ON public.human_review_history;

CREATE POLICY "Allow public read history" ON public.human_review_history FOR SELECT USING (true);
CREATE POLICY "Allow public insert history" ON public.human_review_history FOR INSERT WITH CHECK (true);


-- Table 3: Automated Scan Results (Keyed by Google Drive enterprise_folder_id + requirement_id)
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

CREATE INDEX IF NOT EXISTS idx_scan_results_folder ON public.scan_results(enterprise_folder_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_enterprise ON public.scan_results(enterprise_id);
ALTER TABLE public.scan_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read scan results" ON public.scan_results;
DROP POLICY IF EXISTS "Allow public write scan results" ON public.scan_results;

CREATE POLICY "Allow public read scan results" ON public.scan_results FOR SELECT USING (true);
CREATE POLICY "Allow public write scan results" ON public.scan_results FOR ALL USING (true) WITH CHECK (true);


-- Table 4: Online Scan Jobs (Status Tracking for Polling & Safe Diagnostics)
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

CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON public.scan_jobs(status, created_at);
ALTER TABLE public.scan_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read scan jobs" ON public.scan_jobs;
DROP POLICY IF EXISTS "Allow public write scan jobs" ON public.scan_jobs;

CREATE POLICY "Allow public read scan jobs" ON public.scan_jobs FOR SELECT USING (true);
CREATE POLICY "Allow public write scan jobs" ON public.scan_jobs FOR ALL USING (true) WITH CHECK (true);


-- Table 5: Persistent Enterprise Exclusions (Tracker Exclusion, files in Drive untouched)
CREATE TABLE IF NOT EXISTS public.excluded_enterprises (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_key TEXT NOT NULL UNIQUE,
    enterprise_name TEXT,
    normalized_name TEXT,
    drive_folder_id TEXT,
    reason TEXT DEFAULT 'Removed by operational user',
    excluded_by TEXT DEFAULT 'Operational User',
    active BOOLEAN DEFAULT true,
    excluded_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_excluded_enterprises_key ON public.excluded_enterprises(enterprise_key);
CREATE INDEX IF NOT EXISTS idx_excluded_enterprises_active ON public.excluded_enterprises(active);
ALTER TABLE public.excluded_enterprises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read exclusions" ON public.excluded_enterprises;
DROP POLICY IF EXISTS "Allow public write exclusions" ON public.excluded_enterprises;

CREATE POLICY "Allow public read exclusions" ON public.excluded_enterprises FOR SELECT USING (true);
CREATE POLICY "Allow public write exclusions" ON public.excluded_enterprises FOR ALL USING (true) WITH CHECK (true);
