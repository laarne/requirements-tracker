-- Migration 001: Excluded Enterprises Table for Persistent Tracker Exclusions
-- Enables users to exclude enterprises from the active tracker and future Google Drive scans
-- WITHOUT deleting any files or folders from Google Drive.

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
