# Participant Requirements Compliance Tracker & Scanner

A production-grade, AI-powered automated scanner and interactive operational dashboard designed to replace manual checking of hundreds of participant folders with a fast, reliable, human-reviewable compliance workflow.

---

## 1. What System Does

The Participant Requirements Compliance Tracker:
1. **Scans Participant Folders** (from local synced Google Drive directories or direct Google Drive API calls).
2. **Classifies Submitted Files** against 6 mandatory requirement categories:
   - Valid ID
   - Business Permit
   - Pitch Deck
   - Financial Statement
   - ID Photo
   - Registration Form
3. **Calculates Compliance & Verification Metrics** per participant and across cohort.
4. **Detects Suspicious / Corrupt Files** (0-byte files, unsupported extensions, name mismatches) without crashing.
5. **Provides an Operational Web Dashboard** with real-time search, interactive table matrix, requirement breakdown bars, document inspector modal with previews, manual reviewer approval overrides, and CSV reports.

---

## 2. Local Folder Setup

Structure your participant folders inside a root directory (e.g., `./participants`):

```text
requirements-tracker/
│
├── scanner.py
├── data.json
│
└── participants/
    ├── AgriTurkey Farm Enterprise/
    │   ├── valid_id_passport.pdf
    │   ├── dti_business_permit_2026.pdf
    │   ├── agriturkey_pitch_deck_v2.pptx
    │   └── audited_financial_statement_2025.xlsx
    │
    ├── Juan Dela Cruz/
    │   ├── driver_license_id.pdf
    │   └── mayors_permit.pdf
    │
    └── Maria Santos/
        └── passport_photo.png
```

To quickly populate sample test data, run:
```bash
python create_fixtures.py
```

---

## 3. How to Run the Scanner

Run the scanner CLI script to generate or update `data.json`:

```bash
# Scan local folder (default ./participants)
python scanner.py --folder "./participants" --output "data.json"

# View CLI options
python scanner.py --help
```

---

## 4. How to Open the Dashboard

Serve the project folder using any local HTTP web server:

```bash
# Using Python builtin HTTP server
python -m http.server 8000

# Or using npx serve
npx serve ./
```

Then open your browser at `http://localhost:8000`.

---

## 5. Google Drive API Setup (Mode B)

Target Google Drive Folder ID: `1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_`

1. Place your Google Service Account or OAuth client secret file as `credentials.json` in the root folder.
2. Install optional Google Drive dependencies:
   ```bash
   pip install google-api-python-client google-auth-oauthlib
   ```
3. Run scanner in Google Drive mode:
   ```bash
   python scanner.py --mode gdrive --drive-folder "1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_"
   ```

---

## 6. How Document Classification Works

The engine uses a multi-signal classification strategy defined in `config.py`:
- **Filename Keywords**: Matches tokens like `passport`, `permit`, `deck`, `financial`, `headshot`, `registration`.
- **Extension Matching**: Matches `.pdf`, `.png`, `.jpg`, `.pptx`, `.xlsx`, `.docx`.
- **Content Keywords**: Performs text extraction on PDFs/text files to check for key phrases like *"republic of the philippines"*, *"mayor's permit"*, *"balance sheet"*, *"application form"*.
- **Confidence Scoring**: Assigns a probability score (e.g. 0.95 or 95%) to each classification.

---

## 7. Status Definitions

Each document requirement holds one of 5 statuses:

- `MISSING`: No probable file was found.
- `UPLOADED`: A file was detected by AI scan with high confidence, awaiting human review.
- `NEEDS_REVIEW`: AI scan detected low confidence, unsupported extension, corrupt/0-byte file, or name mismatch.
- `APPROVED`: Human reviewer explicitly verified and approved the submission.
- `REJECTED`: Human reviewer explicitly rejected the submission.

---

## 8. How Manual Verification Works

- Clicking any participant row opens the **Right Inspection Drawer**.
- Click **"View Document"** to inspect document metadata, file size, AI confidence, and mock preview.
- Click **"Approve"**, **"Reject"**, or **"Flag Review"** to override automated scan results.
- Overrides are marked as `Source: Human Reviewer` and saved in browser `localStorage`.
- Re-running `python scanner.py` automatically preserves existing human reviews.

---

## 9. How CSV Export Works

Use the **"Export Reports"** dropdown in the dashboard header:
- **Export Full Compliance CSV**: Exports all participants with completion %, verification %, and document status breakdown.
- **Export Missing Requirements CSV**: Filters and exports only participants with incomplete/missing documents.

---

## 10. How to Run Tests

Run the unit test suite:

```bash
python -m unittest discover tests
```

Tests cover:
- Subfolder & file detection
- Classification confidence calculations
- Missing document handling
- Corrupt / 0-byte file handling (`NEEDS_REVIEW`)
- Output JSON schema validation

---

## 11. Known Limitations

- Optical Character Recognition (OCR) for scanned image-only PDFs requires `tesseract` if OCR is enabled. Plain digital PDFs and standard images are fully handled.
- Google Drive API mode requires active internet access and valid credentials.

---

## 12. Security Considerations

- `credentials.json`, `service_account.json`, and `token.json` are excluded via `.gitignore` and NEVER sent to the web frontend.
- Scanning runs strictly on your machine or backend server.
