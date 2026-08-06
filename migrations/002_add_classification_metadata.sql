-- Migration 002: Add classification metadata columns to scan_results
-- These columns support enhanced GROUP/INDIVIDUAL classification and evidence trail.
-- All changes are additive with safe defaults. No existing data is modified.

ALTER TABLE public.scan_results ADD COLUMN IF NOT EXISTS type_confidence NUMERIC DEFAULT 0;
ALTER TABLE public.scan_results ADD COLUMN IF NOT EXISTS type_evidence JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.scan_results ADD COLUMN IF NOT EXISTS member_count INTEGER DEFAULT 0;
ALTER TABLE public.scan_results ADD COLUMN IF NOT EXISTS member_names JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.scan_results ADD COLUMN IF NOT EXISTS status_detail TEXT DEFAULT '';
