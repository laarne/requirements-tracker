"""
Python wrapper for testing content-matching logic.
Since the core matching is in JavaScript, this module reimplements
the key matching patterns for testing purposes.
"""

import re

CONTENT_PATTERNS = {
    "applicationLetter": {
        "filename_keywords": ["application letter", "letter of application", "app letter", "intent letter", "joint application", "start up application", "start-up application", "application"],
        "content_phrases": [
            "application letter", "letter of application", "we are applying", "i am applying",
            "formally applying", "application for", "letter of intent", "intent to apply",
            "submit this application", "apply for", "young farmers challenge",
            "dear sir", "dear madam", "to whom it may concern"
        ],
        "context_words": ["applicant", "application", "apply", "program", "challenge", "submit"],
    },
    "applicationForm": {
        "filename_keywords": ["application form", "app form", "form b", "start up form", "entry form", "registration form", "form"],
        "content_phrases": [
            "application form", "form b", "registration form", "entry form",
            "fill out", "complete the form", "applicant information",
            "name of applicant", "date of birth", "address", "contact number",
            "signature of applicant", "date signed"
        ],
        "context_words": ["form", "fill", "applicant", "information", "signature", "date"],
    },
    "businessModelCanvas": {
        "filename_keywords": ["business model canvas", "business model", "bmc template", "canvas", "bmc", "youth agri-business model", "agri business model", "agribusiness model", "business plan"],
        "content_phrases": [
            "business model canvas", "value proposition", "customer segment",
            "revenue stream", "cost structure", "key partnership", "key activity",
            "key resource", "channel", "customer relationship", "bmc",
            "business plan", "agri-business", "agribusiness"
        ],
        "context_words": ["business", "model", "canvas", "revenue", "customer", "value"],
    },
    "bmcFinancials": {
        "filename_keywords": ["bmc financial", "financial projections", "projections", "financial plan", "bmc financials", "projected financial"],
        "content_phrases": [
            "financial projection", "projected revenue", "projected expense",
            "financial plan", "bmc financial", "startup cost", "capital requirement",
            "break even", "profit loss", "cash flow projection"
        ],
        "context_words": ["financial", "projection", "plan", "revenue", "cost", "profit"],
    },
    "financialFigures": {
        "filename_keywords": ["activity and financial plan", "financial plan", "cashflow", "cash flow", "financial statement", "budget", "income statement", "balance sheet", "expenses", "financial figures", "financial projection", "projected expenses", "projected income"],
        "content_phrases": [
            "financial figure", "expense", "operating expense", "cost breakdown",
            "budget", "income", "revenue", "cash flow", "balance sheet",
            "profit loss", "financial statement", "cost of goods", "sales",
            "projected expense", "monthly expense", "annual expense",
            "capital expenditure", "operating cost", "overhead"
        ],
        "context_words": ["financial", "expense", "budget", "income", "revenue", "cost", "profit"],
    },
    "validId": {
        "filename_keywords": ["valid id", "government id", "national id", "philid", "driver license", "drivers license", "umid", "voter id", "postal id", "prc id", "passport id", "passport", "id card", "scanned copy valid id", "identification", "philsys"],
        "content_phrases": [
            "valid id", "government id", "national id", "driver license",
            "passport", "umid", "voter id", "postal id", "prc id",
            "identification card", "identity card", "philhealth", "sss",
            "date of birth", "id number", "civil status", "citizenship",
            "republic of the philippines", "philippine identification"
        ],
        "context_words": ["id", "license", "passport", "identification", "birth", "number"],
    },
    "swornStatement": {
        "filename_keywords": ["sworn statement", "affidavit", "joint affidavit", "form c", "form j", "declaration new business", "authority to use land", "sworn statement of new business"],
        "content_phrases": [
            "sworn statement", "affidavit", "do hereby swear", "under oath",
            "joint affidavit", "declare", "declaration", "truthful",
            "penalty of perjury", "subscribed and sworn", "notary public"
        ],
        "context_words": ["affidavit", "sworn", "declare", "oath", "notary"],
    },
    "proofOfResidency": {
        "filename_keywords": ["proof of residency", "residency", "residence", "barangay certificate", "barangay clearance", "certificate of residency", "proof of address", "proof of residence"],
        "content_phrases": [
            "proof of residency", "certificate of residency", "barangay certificate",
            "barangay clearance", "proof of address", "residing at",
            "certified resident", "resident of", "address",
            "barangay", "residency certificate", "residence certificate",
            "to whom it may concern", "this is to certify"
        ],
        "context_words": ["residency", "resident", "barangay", "certificate", "address", "certify"],
    },
    "endorsementLetter": {
        "filename_keywords": ["endorsement letter", "endorsement", "endorsment", "recommending letter", "recommendation", "reccomendation", "lgu endorsement", "endorse", "agriculture office", "municipal agriculture"],
        "content_phrases": [
            "endorsement", "endorse", "endorsement letter", "letter of endorsement",
            "recommend", "recommendation", "recommending",
            "we endorse", "this is to endorse", "support the application",
            "municipal agriculture", "agriculture office"
        ],
        "context_words": ["endorse", "endorsement", "recommend", "support", "office"],
    },
    "photo2x2": {
        "filename_keywords": ["2x2", "2 x 2", "2by2", "id photo", "applicant photo", "headshot", "passport photo", "picture", "photo", "2x2 picture", "passport picture"],
        "content_phrases": [],
        "context_words": ["photo", "picture", "headshot"],
    },
    "signatures": {
        "filename_keywords": ["signed", "signature", "signed form", "signed copy", "with signature", "signatories", "signed application"],
        "content_phrases": [
            "signature", "signed", "signatory", "subscribed",
            "name", "date signed", "applicant signature"
        ],
        "context_words": ["signature", "signed", "name"],
    },
    "declarationOfIntent": {
        "filename_keywords": ["declaration of intent", "declaration intent", "intent declaration", "group declaration", "annex a", "joint declaration", "declaration"],
        "content_phrases": [
            "declaration of intent", "intent to", "we intend",
            "declare our intent", "joint declaration", "group declaration",
            "purpose", "objective", "aim to", "propose"
        ],
        "context_words": ["declaration", "intent", "declare", "purpose", "objective"],
    },
}

GROUP_EVIDENCE_PHRASES = [
    "joint", "joint affidavit", "joint application", "joint startup", "joint start-up",
    "partnership", "partners", "co-owner", "co-owners", "group members",
    "multiple applicant", "member list", "member information",
    "we, the undersigned", "all members", "group declaration",
    "association", "cooperative", "organization"
]

INDIVIDUAL_EVIDENCE_PHRASES = [
    "individual application", "sole proprietor", "solo",
    "i, the undersigned", "my application", "personal application"
]


def normalize_text(text):
    if not text:
        return ""
    n = text.lower()
    n = re.sub(r'[\r\n]+', ' ', n)
    n = re.sub(r'\s+', ' ', n)
    n = re.sub(r'[^\w\s.,;:!?\-/]', ' ', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return n


def match_by_filename(filename, requirement_key):
    pattern = CONTENT_PATTERNS.get(requirement_key)
    if not pattern:
        return {"score": 0, "evidence": [], "method": "NO_PATTERN"}

    score = 0
    evidence = []
    method = "NONE"
    normalized_fn = normalize_text(filename)

    for kw in pattern["filename_keywords"]:
        if kw.lower() in normalized_fn:
            score += 0.35
            evidence.append(f'Filename contains "{kw}"')
            method = "FILENAME_EXACT"
            break

    if method == "NONE":
        fn_words = normalized_fn.split()
        kw_words = []
        for kw in pattern["filename_keywords"]:
            kw_words.extend(kw.lower().split())
        overlap = [w for w in fn_words if w in kw_words and len(w) > 2]
        if len(overlap) >= 2:
            score += 0.35 * 0.7
            evidence.append(f'Filename word overlap: {", ".join(overlap)}')
            method = "FILENAME_PARTIAL"

    return {"score": min(score, 1.0), "evidence": evidence, "method": method}


def match_by_content(filename, content):
    normalized_fn = normalize_text(filename)
    normalized_content = normalize_text(content)

    best_score = 0
    best_evidence = []
    best_method = "NONE"
    best_req = None

    for req_key, pattern in CONTENT_PATTERNS.items():
        score = 0
        evidence = []
        method = "NONE"

        for kw in pattern["filename_keywords"]:
            if kw.lower() in normalized_fn:
                score += 0.35
                evidence.append(f'Filename contains "{kw}"')
                method = "FILENAME_EXACT"
                break

        if method == "NONE":
            fn_words = normalized_fn.split()
            kw_words = []
            for kw in pattern["filename_keywords"]:
                kw_words.extend(kw.lower().split())
            overlap = [w for w in fn_words if w in kw_words and len(w) > 2]
            if len(overlap) >= 2:
                score += 0.35 * 0.7
                evidence.append(f'Filename word overlap: {", ".join(overlap)}')
                method = "FILENAME_PARTIAL"

        for phrase in pattern["content_phrases"]:
            if phrase.lower() in normalized_content:
                score += 0.40
                evidence.append(f'Content contains "{phrase}"')
                method = method if method != "NONE" else "OCR_EXACT"
                break

        if score < 0.8:
            context_hits = 0
            matched_words = []
            for word in pattern["context_words"]:
                if word.lower() in normalized_content:
                    context_hits += 1
                    matched_words.append(word)
            if context_hits >= 2:
                context_score = 0.25 * min(context_hits / len(pattern["context_words"]), 1)
                score += context_score
                evidence.append(f'Content context words: {", ".join(matched_words)}')
                method = method if method != "NONE" else "OCR_CONTEXT"

        if score > best_score:
            best_score = score
            best_evidence = evidence
            best_method = method
            best_req = req_key

    return {"score": min(best_score, 1.0), "evidence": best_evidence, "method": best_method, "requirement": best_req}


def classify_group(text):
    normalized = normalize_text(text)
    group_score = 0
    individual_score = 0

    for phrase in GROUP_EVIDENCE_PHRASES:
        if phrase.lower() in normalized:
            group_score += 1

    for phrase in INDIVIDUAL_EVIDENCE_PHRASES:
        if phrase.lower() in normalized:
            individual_score += 1

    if group_score > individual_score and group_score >= 2:
        return "GROUP"
    elif individual_score > group_score and individual_score >= 2:
        return "INDIVIDUAL"
    else:
        return "UNKNOWN"
