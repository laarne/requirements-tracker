# Vercel Deployment & Online Cloud Scanner Guide

This guide details how to deploy the **Unofficial YFC Compliance Tracker** with **Online Cloud Google Drive Scanning** to Vercel.

---

## 1. Vercel Environment Variables Configuration

Configure the following environment variables in your **Vercel Project Settings → Environment Variables**:

| Variable Name | Required | Description | Example / Location |
|---|---|---|---|
| `SUPABASE_URL` | **Yes** | Your Supabase project REST URL | `https://gndnmbdzfoamtgjkvnyr.supabase.co` |
| `SUPABASE_ANON_KEY` | **Yes** | Supabase publishable anon key | `sb_publishable_zojIDwrTmNXHQLWuOhm7yQ_2pIvgypM` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Supabase service-role secret key (Server-only) | From Supabase Dashboard → Settings → API |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **Optional** | Full JSON string of Google Service Account credentials for GDrive API scanning | JSON string from Google Cloud Console |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | **Yes** | Master GDrive folder ID | `12KBAKnxhkKOPBQbZXlWLfsolsBUrDf7y` |
| `SCAN_SECRET` | **Optional** | Secret token to protect `/api/scan` endpoint | Custom secure string |

> [!CAUTION]
> **NEVER expose `SUPABASE_SERVICE_ROLE_KEY` or `GOOGLE_SERVICE_ACCOUNT_JSON` to client-side code.**
> They are strictly accessed inside Vercel serverless functions (`api/scan.js` and `api/scan-status.js`).

---

## 2. Google Service Account Setup (For Online Cloud Scan)

To allow the cloud scanner to access shared Google Drive folders without needing your laptop or browser OAuth popups:

1. Open **[Google Cloud Console](https://console.cloud.google.com/)**.
2. Enable **Google Drive API**.
3. Create a **Service Account** and generate a **JSON key file**.
4. Share the Master Google Drive Folder (`12KBAKnxhkKOPBQbZXlWLfsolsBUrDf7y`) with the Service Account email address (`...@...iam.gserviceaccount.com`).
5. Copy the contents of the JSON key file into Vercel environment variable `GOOGLE_SERVICE_ACCOUNT_JSON`.

---

## 3. Database Schema

The database relies on 4 Supabase tables in `public` schema:

1. `public.human_reviews`: Stores current human reviewer decisions.
2. `public.human_review_history`: Immutable log of all review actions (UPDATE/DELETE blocked by RLS).
3. `public.scan_results`: Automated scanner outputs per enterprise & requirement (`UNIQUE (enterprise_id, requirement_id)`).
4. `public.scan_jobs`: Status tracking (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`) for UI status polling.

To apply or update the database schema, run `schema.sql` against your Supabase database.

---

## 4. End-to-End Online Scan Flow

```text
Browser Dashboard
    ↓ Click "Scan Google Drive"
POST /api/scan (Vercel Serverless Function)
    ↓ Creates job in scan_jobs (status: RUNNING)
Google Drive API / Master Folder Scan
    ↓ Analyzes files & documents
Upserts to public.scan_results
    ↓ Updates scan_jobs (status: COMPLETED)
Browser Polls GET /api/scan-status
    ↓ Receives status: COMPLETED
Dashboard Auto-Refreshes
    └── Merges scan_results + human_reviews + human_review_history
```
