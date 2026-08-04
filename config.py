"""
Canonical Configuration for Program Documentary Requirements.
Source of Truth for YFC Start-Up Enterprise Compliance Tracking.
Features robust multi-signal phrase matching to prevent single-word false positives.
"""

import re

def normalize_text(text: str) -> str:
    """Normalize text by converting to lowercase, removing punctuation/underscores/hyphens."""
    if not text:
        return ""
    cleaned = ''.join([c if c.isalnum() else ' ' for c in text.lower()])
    return ' '.join(cleaned.split())

CANONICAL_REQUIREMENTS = {
    "applicationLetter": {
        "id": "applicationLetter",
        "name": "Application Letter",
        "description": "Formal application letter addressed to the program head",
        "keywords": [
            "application letter", "letter of application", "app letter", 
            "intent letter", "application letter Pasig", "joint application letter", "joint application"
        ],
        "extensions": [".pdf", ".doc", ".docx"],
        "weight": 1.0,
        "content_keywords": ["application letter", "intent to apply", "dear sir", "dear madam", "re application", "yfc application letter"]
    },
    "applicationForm": {
        "id": "applicationForm",
        "name": "Application Form",
        "description": "Signed official Start-Up application form (Form B)",
        "keywords": [
            "application form", "app form", "form b", "start up form", "startup form",
            "b application form start up", "entry form", "registration form", "yfc application form"
        ],
        "extensions": [".pdf", ".doc", ".docx"],
        "weight": 1.0,
        "content_keywords": ["application form", "personal details", "applicant name", "date of birth", "yfc start up form b"]
    },
    "businessModelCanvas": {
        "id": "businessModelCanvas",
        "name": "Business Model Canvas (BMC)",
        "description": "Business Model Canvas presentation or PDF document",
        "keywords": [
            "business model canvas", "bmc", "canvas", "business model", 
            "bmc template", "yfc bmc", "b business model canvas", "b bussines mode"
        ],
        "extensions": [".pdf", ".doc", ".docx", ".ppt", ".pptx"],
        "weight": 1.0,
        "content_keywords": ["business model canvas", "value proposition", "customer segments", "revenue streams", "cost structure", "key partners", "bmc template"]
    },
    "bmcFinancials": {
        "id": "bmcFinancials",
        "name": "BMC Financials",
        "description": "Financial section or figures within the Business Model Canvas",
        "keywords": [
            "bmc financials", "bmc financial", "financial projections", "projections", 
            "yfc bmc financials", "financial plan", "d yfc bmc financials template", "bmc financials template"
        ],
        "extensions": [".pdf", ".xls", ".xlsx", ".doc", ".docx", ".ppt", ".pptx"],
        "weight": 1.2,
        "content_keywords": ["financial projections", "projected revenue", "cost structure", "pricing strategy", "break even", "revenue model", "bmc financials"]
    },
    "financialFigures": {
        "id": "financialFigures",
        "name": "Financial Figures / Expenses",
        "description": "Detailed Financial Figures, Expenses, Projections, Cash Flow, or Budget (Form D)",
        "keywords": [
            "activity and financial plan", "financial plan", "activity plan", "financials template",
            "cashflow", "cash flow", "financial statement", "budget plan", "income statement", "balance sheet"
        ],
        "extensions": [".pdf", ".xls", ".xlsx", ".doc", ".docx"],
        "weight": 1.1,
        "content_keywords": ["weekly expenses", "monthly expenses", "income statement", "balance sheet", "projected cash flow", "budget plan", "revenue and expenses"]
    },
    "validId": {
        "id": "validId",
        "name": "Valid ID",
        "description": "At least one (1) valid government-issued ID (National ID, PhilID, License, Passport, UMID, Postal, Voter's, PRC)",
        "keywords": [
            "valid id", "government id", "national id", "philid", "driver license", "driver's license", 
            "umid", "voter id", "voters id", "voter's id", "postal id", "prc id", "phil id", "id card", "gov id", "passport"
        ],
        "extensions": [".pdf", ".jpg", ".jpeg", ".png"],
        "weight": 1.0,
        "content_keywords": ["driver's license", "driver license", "passport", "identity card", "date of birth", "id no", "philid", "national id", "voter's id", "postal id", "prc id", "sss id"]
    },
    "swornStatement": {
        "id": "swornStatement",
        "name": "Sworn Statement of New Business",
        "description": "Signed Sworn Statement or Affidavit of New Business (Form C / Form J / Authority to Use Land)",
        "keywords": [
            "sworn statement", "affidavit", "affidavit of new business", 
            "sworn statement of new business", "form c", "form j", "declaration new business", "authority to use land or property", "authority to use land"
        ],
        "extensions": [".pdf", ".doc", ".docx"],
        "weight": 1.0,
        "content_keywords": ["sworn statement", "affidavit of new business", "subscribed and sworn", "form c", "form j", "authority to use land"]
    },
    "proofOfResidency": {
        "id": "proofOfResidency",
        "name": "Proof of Barangay Residency",
        "description": "Barangay Certificate of Residency, Utility Bill, or Proof of Address",
        "keywords": [
            "proof of residency", "residency", "residence", "barangay certificate", "barangay clearance", 
            "certificate of residency", "barangay residency", "proof of address", "utility bill"
        ],
        "extensions": [".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"],
        "weight": 1.0,
        "content_keywords": ["certificate of residency", "barangay clearance", "resident of barangay", "proof of residency", "barangay certificate"]
    },
    "endorsementLetter": {
        "id": "endorsementLetter",
        "name": "Endorsement Letter",
        "description": "Endorsement letter from City/Municipal Agriculture Office or Agriculturist",
        "keywords": [
            "endorsement letter", "endorsement", "endorsment", "recommending letter", "recommendation", "reccomendation",
            "lgu endorsement", "endorse", "endorse letter", "municipal agriculture", "city agriculture", "agriculture office"
        ],
        "extensions": [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp"],
        "weight": 1.0,
        "office_keywords": [
            "city agriculture office", "municipal agriculture office", "city agriculturist", 
            "municipal agriculturist", "agriculture office", "office of the city agriculturist", 
            "office of the municipal agriculturist"
        ],
        "content_keywords": [
            "endorsement", "endorsement letter", "hereby endorse", "proudly endorses", "endorses",
            "letter of endorsement", "recommending approval", "municipal agriculture office", 
            "city agriculture office", "municipal agriculturist", "city agriculturist", "agriculture office"
        ]
    },
    "photo2x2": {
        "id": "photo2x2",
        "name": "2 x 2 Photo",
        "description": "2x2 Passport-sized Photograph with white background",
        "keywords": [
            "2x2", "2 x 2", "2by2", "id photo", "applicant photo", "passport photo"
        ],
        "extensions": [".jpg", ".jpeg", ".png", ".webp"],
        "weight": 1.0,
        "content_keywords": []
    },
    "signatures": {
        "id": "signatures",
        "name": "Required Signatures",
        "description": "Verification of required applicant signature on forms and letters",
        "keywords": [
            "signed", "signature", "signed form", "signed copy", "with signature", "digital signature"
        ],
        "extensions": [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"],
        "weight": 1.0,
        "content_keywords": ["signed", "signature", "applicant signature", "signature over printed name"]
    },
    "declarationOfIntent": {
        "id": "declarationOfIntent",
        "name": "Declaration of Intent",
        "description": "Signed Declaration of Intent (Required ONLY for Group-managed enterprises)",
        "keywords": [
            "declaration of intent", "declaration intent", 
            "intent declaration", "group declaration", "annex a", "annex a declaration"
        ],
        "extensions": [".pdf", ".doc", ".docx"],
        "weight": 1.0,
        "content_keywords": ["declaration of intent", "group application", "we the undersigned", "members of"]
    }
}

ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".csv"}
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
MIN_FILE_SIZE_BYTES = 100
