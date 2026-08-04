-- ============================================================================
-- Supabase Schema for Unofficial YFC Participant Requirements Tracker
-- 1. public.human_reviews: Current/latest decision per enterprise + requirement.
-- 2. public.human_review_history: Immutable audit log of every review action.
-- ============================================================================

-- Table 1: Current/Latest Human Review Decisions
CREATE TABLE IF NOT EXISTS public.human_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enterprise_id TEXT NOT NULL,
    requirement_id TEXT NOT NULL,
    file_id TEXT,
    automated_status TEXT,
    human_status TEXT NOT NULL,
    reviewer_name TEXT DEFAULT 'Operational Reviewer',
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT unique_enterprise_requirement UNIQUE (enterprise_id, requirement_id)
);

CREATE INDEX IF NOT EXISTS idx_human_reviews_enterprise ON public.human_reviews(enterprise_id);
ALTER TABLE public.human_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access" ON public.human_reviews;
DROP POLICY IF EXISTS "Allow public write access" ON public.human_reviews;

CREATE POLICY "Allow public read access" ON public.human_reviews FOR SELECT USING (true);
CREATE POLICY "Allow public write access" ON public.human_reviews FOR ALL USING (true) WITH CHECK (true);


-- Table 2: Immutable Review History Log (STRICTLY READ & INSERT ONLY)
CREATE TABLE IF NOT EXISTS public.human_review_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
ALTER TABLE public.human_review_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read history" ON public.human_review_history;
DROP POLICY IF EXISTS "Allow public insert history" ON public.human_review_history;

-- RLS Policy: Anyone can SELECT (read) review history
CREATE POLICY "Allow public read history" ON public.human_review_history FOR SELECT USING (true);

-- RLS Policy: Anyone can INSERT new review history entries
CREATE POLICY "Allow public insert history" ON public.human_review_history FOR INSERT WITH CHECK (true);

-- Note: UPDATE and DELETE policies are intentionally omitted for human_review_history.
-- In Supabase RLS, omitting UPDATE/DELETE policies guarantees that attempts to UPDATE or DELETE
-- existing history records via the API are rejected by PostgreSQL!
