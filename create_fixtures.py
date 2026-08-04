"""
Helper script to generate rich test fixtures in ./participants directory.
Creates subfolders and realistic sample files for multiple participants.
"""

import os
import shutil

PARTICIPANTS = {
    "AgriTurkey Farm Enterprise": [
        ("valid_id_passport.pdf", 250000, "%PDF-1.4 sample passport government ID document content for AgriTurkey"),
        ("dti_business_permit_2026.pdf", 480000, "%PDF-1.4 Mayor's Business Permit DTI Registration Bureau of Internal Revenue"),
        ("agriturkey_pitch_deck_v2.pptx", 1200000, "AgriTurkey Executive Summary Market Problem Solution Revenue Model Pitch"),
        ("audited_financial_statement_2025.xlsx", 350000, "Balance sheet income statement cash flow financial statements"),
        ("2x2_id_photo_owner.jpg", 180000, "JPEG image data headshot 2x2 photo"),
        ("signed_registration_form.pdf", 210000, "%PDF-1.4 Application Form Registration Form applicant name signature date")
    ],
    "Juan Dela Cruz": [
        ("juan_driver_license_id.pdf", 190000, "%PDF-1.4 Driver's License Republic of the Philippines ID No"),
        ("mayors_permit_pasig_2026.pdf", 420000, "%PDF-1.4 Business Permit Pasig City DTI Registration"),
        ("pitch_deck_innovative_agri.pptx", 950000, "Pitch deck problem solution market size target market"),
        ("balance_sheet_income.xlsx", 280000, "Income statement cash flow balance sheet assets liabilities"),
        ("juan_headshot_2x2.jpg", 150000, "JPEG 2x2 ID photo"),
        ("application_form_filled.pdf", 195000, "Registration form application details signature")
    ],
    "Maria Santos": [
        ("national_id_card.pdf", 210000, "%PDF-1.4 Republic of the Philippines National ID Card"),
        ("project_proposal_slides.pptx", 890000, "Executive Summary Business Model Target Market Pitch Deck"),
        ("passport_size_photo.png", 160000, "PNG image 2x2 ID picture"),
        ("program_entry_registration.pdf", 175000, "Application form personal details signature date")
        # Missing: business permit, financial statement
    ],
    "Bayani Biotech Corp": [
        ("sec_registration_certificate.pdf", 510000, "SEC Registration Certificate Business Permit Tax Clearance"),
        ("bayani_biotech_pitch.pdf", 1400000, "%PDF-1.4 Executive Summary Pitch Deck Revenue Projections"),
        ("audited_financials_2025.pdf", 620000, "%PDF-1.4 Audited Financial Statement Balance Sheet Income"),
        ("ceo_id_photo.jpg", 140000, "JPEG headshot photo"),
        ("signed_program_registration.pdf", 220000, "Application form signed registration")
        # Missing: valid_id
    ],
    "EcoHarvest Solutions": [
        ("umid_gov_id.pdf", 230000, "%PDF-1.4 UMID Government ID Republic of the Philippines"),
        ("eco_harvest_business_permit.pdf", 490000, "Business Permit Mayor clearance DTI registration"),
        ("pitch_deck_presentation.pdf", 1100000, "Pitch deck problem solution market size executive summary"),
        ("financial_statements_audited.xlsx", 310000, "Financial statement balance sheet income statement equity"),
        ("owner_2x2_photo.png", 175000, "PNG 2x2 ID photo"),
        ("registration_form_signed.pdf", 185000, "Registration form application signed")
    ],
    "Pedro Reyes": [
        ("requirements_summary.pdf", 150000, "%PDF-1.4 Combined requirements valid ID and registration"),
        ("unreadable_scan.xyz", 450, "Corrupt or unrecognized file format"),
        ("empty_submission_file.pdf", 50, "X")  # Under 100 bytes
    ]
}

def generate_fixtures(base_dir="./participants"):
    os.makedirs(base_dir, exist_ok=True)
    for p_name, files in PARTICIPANTS.items():
        p_dir = os.path.join(base_dir, p_name)
        os.makedirs(p_dir, exist_ok=True)
        for fname, fsize, content in files:
            fpath = os.path.join(p_dir, fname)
            with open(fpath, "wb") as f:
                header = content.encode("utf-8")
                padding = b" " * max(0, fsize - len(header))
                f.write(header + padding)
    print(f"Generated sample fixtures for {len(PARTICIPANTS)} participants in {base_dir}")

if __name__ == "__main__":
    generate_fixtures()
