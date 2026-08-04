# Vercel Deployment & Supabase Setup Guide

This guide explains how to deploy the **Unofficial YFC Participant Requirements Compliance Tracker** to **Vercel** with permanent human review persistence powered by **Supabase**.

---

## 1. Architecture Overview

```text
                  GOOGLE DRIVE (Master Folder: 12KBAKnxhkKOPBQbZXlWLfsolsBUrDf7y)
                                      │
                                      ▼
                        scanner.py (Local Laptop execution)
                                      │
                                      ▼
                        OCR + Document Classification
                                      │
                                      ▼
                                  data.json
                                      │
                                      ▼
                             VERCEL (Public Dashboard)
                                      │
                                      ▼
                             SUPABASE (Human Reviews)
```

- **Local Laptop**: `scanner.py` runs locally whenever you choose to scan Google Drive. Your laptop does **NOT** need to stay online for colleagues to review documents.
- **Vercel**: Hosts the static web dashboard (`index.html`, `style.css`, `app.js`, `data.json`).
- **Supabase**: Permanently stores human review decisions (`APPROVED`, `REJECTED`, `MISSING`, `NEEDS_REVIEW`), reviewer notes, and timestamps. New scans on your laptop will **NEVER** overwrite existing human decisions in Supabase.

---

## 2. Step 1: Supabase Database Setup

1. Log into your [Supabase Dashboard](https://supabase.com/dashboard).
2. Open the **SQL Editor** tab in your project.
3. Paste the contents of `schema.sql` (found in this repository) and click **Run**:

```sql
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

CREATE POLICY "Allow public read access" ON public.human_reviews FOR SELECT USING (true);
CREATE POLICY "Allow public write access" ON public.human_reviews FOR ALL USING (true) WITH CHECK (true);
```

4. Go to **Project Settings → API** and copy:
   - **Project URL** (e.g. `https://xyzcompany.supabase.co`)
   - **Anon / Public Key** (e.g. `eyJhbGci...`)

---

## 3. Step 2: Vercel Environment Variables & Deployment

1. Push your repository to GitHub (`https://github.com/laarne/requirements-tracker`).
2. Log into [Vercel](https://vercel.com) and click **Add New → Project**.
3. Import your GitHub repository (`laarne/requirements-tracker`).
4. Under **Environment Variables**, add:

| Key | Value | Description |
|---|---|---|
| `SUPABASE_URL` | `https://xyzcompany.supabase.co` | Your Supabase Project URL |
| `SUPABASE_ANON_KEY` | `eyJhbGci...` | Your Supabase Anon/Public Key |

5. Click **Deploy**.

---

## 4. Step 3: Configuring Local Environment (Optional)

To test Supabase sync locally on your laptop:
1. Create a script or embed `window.SUPABASE_URL` and `window.SUPABASE_ANON_KEY` in `index.html` or `.env`.
2. When configured, the header status badge will display **`● Supabase Synced`** in green!

---

## 5. Security Checklist

- [x] `.gitignore` excludes `credentials.json`, `token.json`, `.env`, and private key files.
- [x] Only the public `SUPABASE_ANON_KEY` is passed to the frontend browser; the `service_role` key is **NEVER** exposed.
- [x] Row Level Security (RLS) is enabled on the `human_reviews` table.
