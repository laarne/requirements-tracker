"""
Regression tests for the simplified scanner architecture.

Design principles:
- Scanner may automatically mark COMPLETE only when HIGHLY CONFIDENT
- Otherwise mark REVIEW (never MISSING)
- Only humans mark MISSING
- Compliance = COMPLETE / total requirements
- REVIEW and MISSING are both "outstanding"
"""

import pytest


CANONICAL_REQUIREMENTS = {
    "applicationLetter": {
        "name": "Application Letter",
        "keywords": ["application letter", "letter of application", "app letter", "intent letter",
                      "joint application", "start up application", "start-up application",
                      "joint start-up", "joint startup", "startup application", "application"]
    },
    "applicationForm": {
        "name": "Application Form",
        "keywords": ["application form", "app form", "form b", "start up form", "entry form",
                      "registration form", "start-up form"]
    },
    "businessModelCanvas": {
        "name": "Business Model Canvas (BMC)",
        "keywords": ["business model canvas", "business model", "bmc template", "canvas", "bmc"]
    },
    "bmcFinancials": {
        "name": "BMC Financials",
        "keywords": ["bmc financial", "financial projections", "projections", "financial plan"]
    },
    "financialFigures": {
        "name": "Financial Figures / Expenses",
        "keywords": ["activity and financial plan", "financial plan", "cashflow", "cash flow",
                      "financial statement", "budget", "expenses"]
    },
    "validId": {
        "name": "Valid ID",
        "keywords": ["valid id", "government id", "national id", "passport", "id card",
                      "identification", "philsys"]
    },
    "swornStatement": {
        "name": "Sworn Statement of New Business",
        "keywords": ["sworn statement", "affidavit", "joint affidavit", "form c",
                      "declaration new business"]
    },
    "proofOfResidency": {
        "name": "Proof of Residency",
        "keywords": ["proof of residency", "residency", "residence", "barangay certificate",
                      "barangay clearance", "certificate of residency"]
    },
    "endorsementLetter": {
        "name": "Endorsement Letter",
        "keywords": ["endorsement letter", "endorsement", "endorsment", "recommending letter",
                      "recommendation", "lgu endorsement"]
    },
    "photo2x2": {
        "name": "2 x 2 Photo",
        "keywords": ["2x2", "2 x 2", "2by2", "id photo", "applicant photo", "headshot",
                      "passport photo", "picture", "photo"]
    },
    "signatures": {
        "name": "Required Signatures",
        "keywords": ["signed", "signature", "signed form", "signed copy", "signatories"]
    },
    "declarationOfIntent": {
        "name": "Declaration of Intent",
        "keywords": ["declaration of intent", "declaration intent", "intent declaration",
                      "group declaration", "annex a", "joint declaration", "declaration"]
    }
}

FILENAME_ALIASES = {
    "passport id": "validId",
    "passport": "validId",
    "id picture": "validId",
    "id pic": "validId",
    "identification": "validId",
    "2x2 picture": "photo2x2",
    "2x2 photo": "photo2x2",
    "id photo 2x2": "photo2x2",
    "passport picture": "photo2x2",
    "headshot": "photo2x2",
    "photo": "photo2x2",
    "picture": "photo2x2",
    "bmc financials": "bmcFinancials",
    "bmc financial": "bmcFinancials",
    "financial projections": "bmcFinancials",
    "joint affidavit": "swornStatement",
    "affidavit": "swornStatement",
    "barangay certificate": "proofOfResidency",
    "barangay clearance": "proofOfResidency",
    "certificate of residency": "proofOfResidency",
    "endorsement": "endorsementLetter",
    "lgu endorsement": "endorsementLetter",
    "application": "applicationForm",
    "form b": "applicationForm",
    "registration form": "applicationForm",
    "business model": "businessModelCanvas",
    "bmc": "businessModelCanvas",
    "canvas": "businessModelCanvas",
    "signed": "signatures",
    "signature": "signatures",
    "joint start-up": "applicationLetter",
    "joint startup": "applicationLetter",
    "declaration": "declarationOfIntent",
}


def normalize_filename(name):
    if not name:
        return ""
    import re
    n = name.lower()
    n = re.sub(r'[\(\)\[\]]', ' ', n)
    n = re.sub(r'[-_]', ' ', n)
    n = re.sub(r'\b[a-z]\d', lambda m: ' ' + m.group(1), n)
    n = re.sub(r'^\d+[\.\s]+', '', n)
    n = re.sub(r'\.(pdf|docx?|xlsx?|jpg|jpeg|png|gif|tiff?)$', '', n, flags=re.IGNORECASE)
    n = re.sub(r'\s+', ' ', n).strip()
    return n


def match_filename_to_requirement(req_key, filename, mime_type=""):
    req = CANONICAL_REQUIREMENTS.get(req_key)
    if not req:
        return None

    normalized = normalize_filename(filename)
    lower_filename = normalized.lower()
    mime = (mime_type or "").lower()

    score = 0
    evidence = []
    method = "NONE"

    for alias, target_req in FILENAME_ALIASES.items():
        if target_req == req_key:
            norm_alias = alias.lower().replace("-", " ").replace("_", " ")
            if norm_alias in lower_filename:
                score = 0.95
                evidence.append(f'Alias match: "{alias}"')
                method = "FILENAME_ALIAS"
                break

    if score == 0:
        for kw in req["keywords"]:
            if kw.lower() in lower_filename:
                score = 0.9
                evidence.append(f'Keyword match: "{kw}"')
                method = "FILENAME_KEYWORD"
                break

    if score == 0:
        fn_words = lower_filename.split()
        kw_words = []
        for kw in req["keywords"]:
            kw_words.extend(kw.lower().split())
        overlap = [w for w in fn_words if w in kw_words and len(w) > 3]
        if len(overlap) >= 2:
            score = 0.6
            evidence.append(f'Word overlap: {", ".join(overlap)}')
            method = "FILENAME_PARTIAL"

    if score == 0 and req_key == "photo2x2":
        if mime.startswith("image/"):
            score = 0.3
            evidence.append("Image file (no filename match)")
            method = "MIME_TYPE"

    if score == 0:
        return None

    return {
        "confidence": score,
        "evidence": evidence,
        "method": method,
        "filename": filename
    }


def process_files_for_requirements(files, applicant_type="INDIVIDUAL"):
    reqs = {}
    req_key_order = [
        "bmcFinancials", "businessModelCanvas", "applicationForm", "applicationLetter",
        "financialFigures", "validId", "swornStatement", "proofOfResidency",
        "endorsementLetter", "photo2x2", "signatures", "declarationOfIntent"
    ]

    file_assignments = {}

    for req_key in req_key_order:
        matched_files = []

        for f in files:
            if f["id"] in file_assignments:
                continue

            match_result = match_filename_to_requirement(req_key, f["name"], f.get("mimeType", ""))
            if match_result and match_result["confidence"] > 0:
                matched_files.append({
                    "fileId": f["id"],
                    "name": f["name"],
                    "confidence": match_result["confidence"],
                    "detectionMethod": match_result["method"],
                    "evidence": match_result["evidence"]
                })
                file_assignments[f["id"]] = req_key

        matched_files.sort(key=lambda x: x["confidence"], reverse=True)

        status = "REVIEW"
        status_detail = "No confident match was found. Please verify manually."

        if matched_files:
            top_match = matched_files[0]
            if top_match["confidence"] >= 0.85:
                status = "COMPLETE"
                status_detail = f'Matched via {top_match["detectionMethod"]} (confidence: {top_match["confidence"]})'
            else:
                status = "REVIEW"
                status_detail = f'Possible match (confidence: {top_match["confidence"]}). Please verify.'
        elif req_key == "declarationOfIntent" and applicant_type == "INDIVIDUAL":
            status = "NOT_APPLICABLE"
            status_detail = "Not required for INDIVIDUAL applicants"

        reqs[req_key] = {
            "status": status,
            "automatedStatus": status,
            "files": matched_files,
            "matchedFileNames": [f["name"] for f in matched_files],
            "statusDetail": status_detail
        }

    return reqs


def calculate_compliance(requirements):
    applicable = {k: v for k, v in requirements.items() if v["status"] != "NOT_APPLICABLE"}
    total = len(applicable)
    complete = sum(1 for v in applicable.values() if v["status"] == "COMPLETE")
    review = sum(1 for v in applicable.values() if v["status"] == "REVIEW")
    missing = sum(1 for v in applicable.values() if v["status"] == "MISSING")
    percentage = round((complete / total) * 1000) / 10 if total > 0 else 0.0
    return {
        "complete": complete,
        "review": review,
        "missing": missing,
        "total": total,
        "percentage": percentage
    }


class TestHighConfidenceFilenameComplete:
    def test_application_letter_alias(self):
        files = [{"id": "1", "name": "Joint Start-up Aplication.pdf"}]
        reqs = process_files_for_requirements(files)
        assert reqs["applicationLetter"]["status"] == "COMPLETE"
        assert reqs["applicationLetter"]["files"][0]["confidence"] >= 0.85

    def test_application_form_keyword(self):
        files = [{"id": "1", "name": "Form B Start-Up.docx"}]
        reqs = process_files_for_requirements(files)
        assert reqs["applicationForm"]["status"] == "COMPLETE"

    def test_sworn_statement_alias(self):
        files = [{"id": "1", "name": "Joint Affidavit of New Business.pdf"}]
        reqs = process_files_for_requirements(files)
        assert reqs["swornStatement"]["status"] == "COMPLETE"

    def test_declaration_of_intent_keyword(self):
        files = [{"id": "1", "name": "Declaration of Intent.docx"}]
        reqs = process_files_for_requirements(files)
        assert reqs["declarationOfIntent"]["status"] == "COMPLETE"

    def test_proof_of_residency_alias(self):
        files = [{"id": "1", "name": "Barangay Certificate.pdf"}]
        reqs = process_files_for_requirements(files)
        assert reqs["proofOfResidency"]["status"] == "COMPLETE"

    def test_valid_id_alias(self):
        files = [{"id": "1", "name": "Passport Scan.jpg"}]
        reqs = process_files_for_requirements(files)
        assert reqs["validId"]["status"] == "COMPLETE"

    def test_photo_2x2_keyword(self):
        files = [{"id": "1", "name": "2x2 Photo.jpg"}]
        reqs = process_files_for_requirements(files)
        assert reqs["photo2x2"]["status"] == "COMPLETE"

    def test_endorsement_letter_keyword(self):
        files = [{"id": "1", "name": "Endorsement Letter.pdf"}]
        reqs = process_files_for_requirements(files)
        assert reqs["endorsementLetter"]["status"] == "COMPLETE"

    def test_bmc_keyword(self):
        files = [{"id": "1", "name": "Business Model Canvas.docx"}]
        reqs = process_files_for_requirements(files)
        assert reqs["businessModelCanvas"]["status"] == "COMPLETE"

    def test_bmc_financials_keyword(self):
        files = [{"id": "1", "name": "BMC Financials Projections.xlsx"}]
        reqs = process_files_for_requirements(files)
        assert reqs["bmcFinancials"]["status"] == "COMPLETE"

    def test_financial_figures_keyword(self):
        files = [{"id": "1", "name": "Cash Flow Statement.xlsx"}]
        reqs = process_files_for_requirements(files)
        assert reqs["financialFigures"]["status"] == "COMPLETE"

    def test_signatures_keyword(self):
        files = [{"id": "1", "name": "Signatories List.pdf"}]
        reqs = process_files_for_requirements(files)
        assert reqs["signatures"]["status"] == "COMPLETE"


class TestAmbiguousFilenameReview:
    def test_ambiguous_name_review(self):
        files = [{"id": "1", "name": "document.pdf"}]
        reqs = process_files_for_requirements(files)
        for req_key in CANONICAL_REQUIREMENTS:
            if reqs[req_key]["status"] != "NOT_APPLICABLE":
                assert reqs[req_key]["status"] == "REVIEW", f"{req_key} should be REVIEW for ambiguous filename"

    def test_partial_keyword_review(self):
        files = [{"id": "1", "name": "aplication form.docx"}]
        reqs = process_files_for_requirements(files)
        assert reqs["applicationForm"]["status"] == "REVIEW"

    def test_wrong_category_review(self):
        files = [{"id": "1", "name": "my finances 2024.docx"}]
        reqs = process_files_for_requirements(files)
        assert reqs["bmcFinancials"]["status"] == "REVIEW"
        assert reqs["financialFigures"]["status"] == "REVIEW"


class TestNoCandidateReview:
    def test_empty_folder_review(self):
        files = []
        reqs = process_files_for_requirements(files)
        for req_key in CANONICAL_REQUIREMENTS:
            if req_key == "declarationOfIntent":
                continue
            assert reqs[req_key]["status"] == "REVIEW", f"{req_key} should be REVIEW when no files"

    def test_unrelated_files_review(self):
        files = [{"id": "1", "name": "notes.txt"}]
        reqs = process_files_for_requirements(files)
        for req_key in CANONICAL_REQUIREMENTS:
            if req_key == "declarationOfIntent":
                continue
            assert reqs[req_key]["status"] == "REVIEW", f"{req_key} should be REVIEW for unrelated file"

    def test_declaration_not_applicable_individual(self):
        files = []
        reqs = process_files_for_requirements(files, applicant_type="INDIVIDUAL")
        assert reqs["declarationOfIntent"]["status"] == "NOT_APPLICABLE"

    def test_declaration_review_group(self):
        files = []
        reqs = process_files_for_requirements(files, applicant_type="GROUP")
        assert reqs["declarationOfIntent"]["status"] == "REVIEW"


class TestScannerNeverCreatesMissing:
    def test_no_missing_in_high_confidence(self):
        files = [{"id": "1", "name": "Application Letter.pdf"}]
        reqs = process_files_for_requirements(files)
        for req_key, req_data in reqs.items():
            assert req_data["status"] != "MISSING", f"Scanner should never auto-create MISSING for {req_key}"

    def test_no_missing_in_ambiguous(self):
        files = [{"id": "1", "name": "random_file.pdf"}]
        reqs = process_files_for_requirements(files)
        for req_key, req_data in reqs.items():
            assert req_data["status"] != "MISSING", f"Scanner should never auto-create MISSING for {req_key}"

    def test_no_missing_empty_folder(self):
        files = []
        reqs = process_files_for_requirements(files)
        for req_key, req_data in reqs.items():
            assert req_data["status"] != "MISSING", f"Scanner should never auto-create MISSING for {req_key}"

    def test_automated_status_never_missing(self):
        all_filenames = [
            "Joint Start-up Application.pdf",
            "Application Form.docx",
            "random.txt",
            "2x2 Photo.jpg",
            "",
        ]
        for fname in all_filenames:
            files = [{"id": "1", "name": fname}] if fname else []
            reqs = process_files_for_requirements(files)
            for req_key, req_data in reqs.items():
                assert req_data["automatedStatus"] != "MISSING", \
                    f"automatedStatus should never be MISSING for {req_key} with file '{fname}'"


class TestUserMarksReviewAsComplete:
    def test_mark_review_complete(self):
        files = [{"id": "1", "name": "some document.pdf"}]
        reqs = process_files_for_requirements(files)
        assert reqs["applicationLetter"]["status"] == "REVIEW"

        reqs["applicationLetter"]["status"] = "COMPLETE"
        reqs["applicationLetter"]["review"] = {
            "manualStatus": "COMPLETE",
            "reviewedBy": "Test User",
            "reviewedAt": "2026-01-01T00:00:00Z"
        }
        assert reqs["applicationLetter"]["status"] == "COMPLETE"
        assert reqs["applicationLetter"]["review"]["manualStatus"] == "COMPLETE"

    def test_compliance_after_marking_complete(self):
        files = [
            {"id": "1", "name": "Joint Start-up Aplication.pdf"},
            {"id": "2", "name": "random.pdf"},
        ]
        reqs = process_files_for_requirements(files)
        compliance = calculate_compliance(reqs)
        assert compliance["complete"] == 1
        assert compliance["review"] >= 1

        reqs["applicationForm"]["status"] = "COMPLETE"
        compliance = calculate_compliance(reqs)
        assert compliance["complete"] == 2


class TestUserMarksReviewAsMissing:
    def test_mark_review_missing(self):
        files = [{"id": "1", "name": "some document.pdf"}]
        reqs = process_files_for_requirements(files)
        assert reqs["applicationLetter"]["status"] == "REVIEW"

        reqs["applicationLetter"]["status"] = "MISSING"
        reqs["applicationLetter"]["review"] = {
            "manualStatus": "MISSING",
            "reviewedBy": "Test User",
            "reviewedAt": "2026-01-01T00:00:00Z"
        }
        assert reqs["applicationLetter"]["status"] == "MISSING"
        assert reqs["applicationLetter"]["review"]["manualStatus"] == "MISSING"

    def test_compliance_after_marking_missing(self):
        files = [
            {"id": "1", "name": "Joint Start-up Aplication.pdf"},
            {"id": "2", "name": "random.pdf"},
        ]
        reqs = process_files_for_requirements(files)
        compliance_before = calculate_compliance(reqs)

        reqs["applicationForm"]["status"] = "MISSING"
        compliance_after = calculate_compliance(reqs)
        assert compliance_after["missing"] == compliance_before["missing"] + 1
        assert compliance_after["complete"] == compliance_before["complete"]


class TestComplianceCalculation:
    def test_all_complete_100_percent(self):
        files = [
            {"id": "1", "name": "Joint Start-up Aplication.pdf"},
            {"id": "2", "name": "Form B Start-Up.pdf"},
            {"id": "3", "name": "Business Model Canvas.docx"},
            {"id": "4", "name": "BMC Financials Projections.xlsx"},
            {"id": "5", "name": "Cash Flow Statement.xlsx"},
            {"id": "6", "name": "Passport Scan.jpg"},
            {"id": "7", "name": "Joint Affidavit.pdf"},
            {"id": "8", "name": "Barangay Certificate.pdf"},
            {"id": "9", "name": "Endorsement Letter.pdf"},
            {"id": "10", "name": "2x2 Photo.jpg"},
            {"id": "11", "name": "Signatories List.pdf"},
            {"id": "12", "name": "Declaration of Intent.docx"},
        ]
        reqs = process_files_for_requirements(files)
        compliance = calculate_compliance(reqs)
        assert compliance["percentage"] == 100.0
        assert compliance["complete"] == 12
        assert compliance["review"] == 0
        assert compliance["missing"] == 0

    def test_half_complete_50_percent(self):
        files = [
            {"id": "1", "name": "Joint Start-up Aplication.pdf"},
            {"id": "2", "name": "Form B Start-Up.pdf"},
            {"id": "3", "name": "Business Model Canvas.docx"},
            {"id": "4", "name": "BMC Financials Projections.xlsx"},
            {"id": "5", "name": "random.pdf"},
            {"id": "6", "name": "random2.pdf"},
            {"id": "7", "name": "random3.pdf"},
            {"id": "8", "name": "random4.pdf"},
            {"id": "9", "name": "random5.pdf"},
            {"id": "10", "name": "random6.pdf"},
            {"id": "11", "name": "random7.pdf"},
            {"id": "12", "name": "random8.pdf"},
        ]
        reqs = process_files_for_requirements(files)
        compliance = calculate_compliance(reqs)
        assert compliance["complete"] == 4
        assert compliance["review"] == 7
        assert compliance["percentage"] < 50.0

    def test_review_outstanding(self):
        reqs = {}
        for req_key in CANONICAL_REQUIREMENTS:
            reqs[req_key] = {"status": "REVIEW", "files": []}
        reqs["applicationLetter"]["status"] = "COMPLETE"
        compliance = calculate_compliance(reqs)
        assert compliance["complete"] == 1
        assert compliance["review"] == 11
        assert compliance["percentage"] < 10.0

    def test_missing_outstanding(self):
        reqs = {}
        for req_key in CANONICAL_REQUIREMENTS:
            reqs[req_key] = {"status": "MISSING", "files": []}
        reqs["applicationLetter"]["status"] = "COMPLETE"
        compliance = calculate_compliance(reqs)
        assert compliance["complete"] == 1
        assert compliance["missing"] == 11
        assert compliance["percentage"] < 10.0

    def test_review_and_missing_both_outstanding(self):
        reqs = {}
        for req_key in CANONICAL_REQUIREMENTS:
            reqs[req_key] = {"status": "REVIEW", "files": []}
        reqs["applicationLetter"]["status"] = "COMPLETE"
        reqs["applicationForm"]["status"] = "COMPLETE"
        reqs["swornStatement"]["status"] = "MISSING"
        compliance = calculate_compliance(reqs)
        assert compliance["complete"] == 2
        assert compliance["review"] == 9
        assert compliance["missing"] == 1
        assert compliance["percentage"] < 20.0

    def test_not_applicable_excluded(self):
        reqs = {}
        for req_key in CANONICAL_REQUIREMENTS:
            reqs[req_key] = {"status": "REVIEW", "files": []}
        reqs["declarationOfIntent"]["status"] = "NOT_APPLICABLE"
        compliance = calculate_compliance(reqs)
        assert compliance["total"] == 11
        assert compliance["review"] == 11

    def test_percentage_rounding(self):
        reqs = {}
        count = 0
        for req_key in CANONICAL_REQUIREMENTS:
            if count < 7:
                reqs[req_key] = {"status": "COMPLETE", "files": []}
            else:
                reqs[req_key] = {"status": "REVIEW", "files": []}
            count += 1
        compliance = calculate_compliance(reqs)
        assert compliance["complete"] == 7
        assert compliance["percentage"] == round((7 / 12) * 1000) / 10


class TestFileAssignmentNoDoubleCounting:
    def test_file_assigned_once(self):
        files = [
            {"id": "1", "name": "Form B Start-Up.pdf"},
            {"id": "2", "name": "random.pdf"},
        ]
        reqs = process_files_for_requirements(files)
        assert len(reqs["applicationForm"]["files"]) == 1
        assert reqs["applicationForm"]["files"][0]["name"] == "Form B Start-Up.pdf"

    def test_file_not_double_counted(self):
        files = [
            {"id": "1", "name": "Application Letter and Form.pdf"},
        ]
        reqs = process_files_for_requirements(files)
        total_matched = sum(len(r["files"]) for r in reqs.values())
        assert total_matched <= 1


class TestGroupApplicantType:
    def test_group_with_multiple_files(self):
        files = [
            {"id": "1", "name": "Joint Start-up Aplication.pdf"},
            {"id": "2", "name": "Joint Affidavit.pdf"},
            {"id": "3", "name": "Declaration of Intent.docx"},
        ]
        reqs = process_files_for_requirements(files, applicant_type="GROUP")
        assert reqs["applicationLetter"]["status"] == "COMPLETE"
        assert reqs["swornStatement"]["status"] == "COMPLETE"
        assert reqs["declarationOfIntent"]["status"] == "COMPLETE"
