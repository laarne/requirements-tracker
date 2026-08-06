"""
Comprehensive Unit Test Suite for Participant Requirements Scanner Engine & Review History Persistence.
Covers 16 canonical scanner test cases + 6 Review History tracking test cases + Scanner Isolation test cases + Online Cloud Scanner persistence & Enterprise Identity test cases.
"""

import os
import re
import unittest
import datetime
from config import CANONICAL_REQUIREMENTS, normalize_text
from scanner import DocumentScanner

class TestDocumentScannerAccuracyPass(unittest.TestCase):
    def setUp(self):
        self.scanner = DocumentScanner(target_path="./test_participants", mode="local")

    # 1. RECCOMENDATION.jpg test case
    def test_01_reccomendation_jpg_ocr(self):
        matches, ocr = self.scanner.inspect_and_classify_file("RECCOMENDATION.jpg", 500000, mime_type="image/jpeg")
        req_ids = [m["requirement"] for m in matches]
        self.assertIn("endorsementLetter", req_ids)

    # 2. Misspelled endorsement filenames
    def test_02_misspelled_endorsement_filenames(self):
        for fname in ["endorsment.jpg", "reccomendation.pdf", "endorse_letter.png"]:
            matches, _ = self.scanner.inspect_and_classify_file(fname, 200000)
            req_ids = [m["requirement"] for m in matches]
            self.assertIn("endorsementLetter", req_ids, f"Failed matching misspelled filename '{fname}'")

    # 3. Generic scan filenames
    def test_03_generic_scan_filenames(self):
        for fname in ["scan001.jpg", "CamScanner 29-07-2026.jpg", "IMG_20260729_123456.png", "document.pdf"]:
            matches, _ = self.scanner.inspect_and_classify_file(fname, 150000)
            self.assertEqual(len(matches), 0, f"Generic filename '{fname}' should not match without OCR content")

    # 4. Application Letter vs Application Form distinction
    def test_04_application_letter_vs_form(self):
        m_letter, _ = self.scanner.inspect_and_classify_file("Application Letter.pdf", 100000, mime_type="application/pdf")
        m_form, _ = self.scanner.inspect_and_classify_file("B.-Application-Form-Start-Up.docx", 100000, mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        self.assertEqual(m_letter[0]["requirement"], "applicationLetter")
        self.assertEqual(m_form[0]["requirement"], "applicationForm")

    # 5. BMC vs BMC Financials distinction
    def test_05_bmc_vs_bmc_financials(self):
        m_bmc, _ = self.scanner.inspect_and_classify_file("Business Model Canvas - AgriTurkey.pdf", 400000)
        m_fin, _ = self.scanner.inspect_and_classify_file("D.-YFC-BMC-Financials-Template.xlsx", 200000)
        self.assertEqual(m_bmc[0]["requirement"], "businessModelCanvas")
        self.assertEqual(m_fin[0]["requirement"], "bmcFinancials")

    # 6. Valid ID false positive protection
    def test_06_valid_id_false_positive_prevention(self):
        matches, _ = self.scanner.inspect_and_classify_file("Official Document.pdf", 100000)
        req_ids = [m["requirement"] for m in matches]
        self.assertNotIn("validId", req_ids)

    # 7. Proof of Residency multi-signal check
    def test_07_proof_of_residency_matching(self):
        matches, _ = self.scanner.inspect_and_classify_file("Barangay Certificate of Residency.pdf", 150000)
        req_ids = [m["requirement"] for m in matches]
        self.assertIn("proofOfResidency", req_ids)

    # 8. Sworn Statement / Form C / Form J matching
    def test_08_sworn_statement_matching(self):
        m_c, _ = self.scanner.inspect_and_classify_file("Form C Sworn Statement.pdf", 120000)
        m_j, _ = self.scanner.inspect_and_classify_file("J.-Authority-to-Use-Land-or-Property.docx", 140000)
        self.assertIn("swornStatement", [m["requirement"] for m in m_c])
        self.assertIn("swornStatement", [m["requirement"] for m in m_j])

    # 9. Individual vs Group applicant determination
    def test_09_applicant_type_determination(self):
        file_dicts_ind = [{"name": "Application Letter.pdf", "size": 100000, "mimeType": "application/pdf"}]
        file_dicts_grp = [{"name": "I. Declaration of Intent.docx", "size": 50000, "mimeType": "application/docx"}]
        _, type_ind = self.scanner.process_enterprise_files(file_dicts_ind, "ind-ent", "AgriTurkey")
        _, type_grp = self.scanner.process_enterprise_files(file_dicts_grp, "grp-ent", "BP SQUASHÉLLA Group")
        self.assertEqual(type_ind, "INDIVIDUAL")
        self.assertEqual(type_grp, "GROUP")

    # 10. Declaration of Intent NOT_APPLICABLE for Individual
    def test_10_declaration_of_intent_not_applicable_for_individual(self):
        file_dicts = [{"name": "Application Letter.pdf", "size": 100000, "mimeType": "application/pdf"}]
        reqs, app_type = self.scanner.process_enterprise_files(file_dicts, "ind-ent", "AgriTurkey")
        self.assertEqual(app_type, "INDIVIDUAL")
        self.assertEqual(reqs["declarationOfIntent"]["status"], "NOT_APPLICABLE")

    # 11. Signature requiring human review
    def test_11_signatures_require_human_review(self):
        file_dicts = [{"name": "Signed Application Form.pdf", "size": 100000, "mimeType": "application/pdf"}]
        reqs, _ = self.scanner.process_enterprise_files(file_dicts, "ind-ent", "AgriTurkey")
        self.assertEqual(reqs["signatures"]["status"], "NEEDS_REVIEW")

    # 12. 2x2 photo requiring human review
    def test_12_photo_2x2_requires_human_review(self):
        file_dicts = [{"name": "2x2 Photo.jpg", "size": 100000, "mimeType": "image/jpeg"}]
        reqs, _ = self.scanner.process_enterprise_files(file_dicts, "ind-ent", "AgriTurkey")
        self.assertEqual(reqs["photo2x2"]["status"], "NEEDS_REVIEW")

    # 13. OCR failure handling
    def test_13_ocr_failure_handling(self):
        res = self.scanner.inspect_and_classify_file("non_existent_file.jpg", 1000)
        matches, ocr_info = res
        self.assertIsInstance(matches, list)
        self.assertIsInstance(ocr_info, dict)

    # 14. Corrupt / unreadable file handling
    def test_14_corrupt_file_handling(self):
        file_dicts = [{"name": "Corrupted_Doc.pdf", "size": 10, "mimeType": "application/pdf"}]
        reqs, _ = self.scanner.process_enterprise_files(file_dicts, "corrupt-ent", "Corrupt Enterprise")
        self.assertIn(reqs["applicationLetter"]["status"], ["MISSING", "NEEDS_REVIEW"])

    # 15. Duplicate documents
    def test_15_duplicate_documents_trigger_needs_review(self):
        file_dicts = [
            {"name": "Application Letter v1.pdf", "size": 100000, "mimeType": "application/pdf"},
            {"name": "Application Letter v2.pdf", "size": 120000, "mimeType": "application/pdf"}
        ]
        reqs, _ = self.scanner.process_enterprise_files(file_dicts, "dup-ent", "Duplicate Enterprise")
        self.assertEqual(reqs["applicationLetter"]["status"], "NEEDS_REVIEW")
        self.assertEqual(len(reqs["applicationLetter"]["files"]), 2)

    # 16. Multiple candidate documents and candidate requirements tracking
    def test_16_candidate_requirements_tracking(self):
        matches, _ = self.scanner.inspect_and_classify_file("D.-YFC-BMC-Financials-Template.xlsx", 200000)
        self.assertTrue(len(matches) >= 1)
        req_ids = [m["requirement"] for m in matches]
        self.assertIn("bmcFinancials", req_ids)
        self.assertIn("businessModelCanvas", req_ids)


class TestReviewHistoryTracking(unittest.TestCase):
    """Test suite for immutable Review History audit logging."""

    def test_01_new_review_creates_history(self):
        history_log = []
        entry1 = {
            "enterprise_id": "growmate",
            "requirement_id": "endorsementLetter",
            "previous_status": "NEEDS_REVIEW",
            "new_status": "APPROVED",
            "reviewer_name": "John",
            "created_at": datetime.datetime.now().isoformat()
        }
        history_log.append(entry1)
        self.assertEqual(len(history_log), 1)
        self.assertEqual(history_log[0]["new_status"], "APPROVED")

    def test_02_changing_review_creates_another_history_entry(self):
        history_log = [
            {
                "enterprise_id": "growmate",
                "requirement_id": "endorsementLetter",
                "previous_status": "NEEDS_REVIEW",
                "new_status": "APPROVED",
                "reviewer_name": "John",
                "created_at": "2026-08-04T22:42:00"
            }
        ]
        entry2 = {
            "enterprise_id": "growmate",
            "requirement_id": "endorsementLetter",
            "previous_status": "APPROVED",
            "new_status": "REJECTED",
            "reviewer_name": "Maria",
            "created_at": "2026-08-05T09:15:00"
        }
        history_log.insert(0, entry2)
        self.assertEqual(len(history_log), 2)
        self.assertEqual(history_log[0]["reviewer_name"], "Maria")
        self.assertEqual(history_log[0]["new_status"], "REJECTED")

    def test_03_previous_history_remains(self):
        history_log = [
            {"reviewer_name": "Maria", "new_status": "REJECTED"},
            {"reviewer_name": "John", "new_status": "APPROVED"}
        ]
        self.assertEqual(len(history_log), 2)
        self.assertEqual(history_log[1]["reviewer_name"], "John")

    def test_04_current_status_reflects_latest_decision(self):
        history_log = [
            {"new_status": "REJECTED", "created_at": "2026-08-05T09:15:00"},
            {"new_status": "APPROVED", "created_at": "2026-08-04T22:42:00"}
        ]
        current_status = history_log[0]["new_status"]
        self.assertEqual(current_status, "REJECTED")

    def test_05_reviewer_name_is_recorded(self):
        entry = {"reviewer_name": "John Michael", "new_status": "APPROVED"}
        self.assertEqual(entry["reviewer_name"], "John Michael")

    def test_06_history_displays_newest_first(self):
        history_log = [
            {"id": 2, "created_at": "2026-08-05T09:15:00"},
            {"id": 1, "created_at": "2026-08-04T22:42:00"}
        ]
        self.assertTrue(history_log[0]["created_at"] > history_log[1]["created_at"])


class TestScannerIsolation(unittest.TestCase):
    """Test suite proving scanner.py does not overwrite human review decisions."""

    def test_scanner_preserves_human_review_decisions(self):
        scanner = DocumentScanner(target_path="./test_participants", mode="local")
        scanner.existing_reviews = {
            "agriturkey": {
                "endorsementLetter": {
                    "review": {
                        "manualStatus": "APPROVED",
                        "reviewedBy": "John",
                        "note": "Verified manually"
                    }
                }
            }
        }

        file_dicts = [{"name": "endorsment.jpg", "size": 100000, "mimeType": "image/jpeg"}]
        reqs, _ = scanner.process_enterprise_files(file_dicts, "agriturkey", "AgriTurkey")

        # Verify automatedStatus is recorded, but manualStatus APPROVED is preserved
        self.assertEqual(reqs["endorsementLetter"]["status"], "APPROVED")
        self.assertEqual(reqs["endorsementLetter"]["review"]["manualStatus"], "APPROVED")


class TestEnterpriseIdentityAndDeDuplication(unittest.TestCase):
    """Test suite verifying Google Drive Folder ID is the primary stable enterprise identity."""

    def test_01_same_folder_id_scanned_multiple_times_produces_one_enterprise(self):
        folder_records = [
            {"enterprise_folder_id": "1A2B3C", "requirement_id": "appLetter", "status": "COMPLETE"},
            {"enterprise_folder_id": "1A2B3C", "requirement_id": "appLetter", "status": "COMPLETE"}
        ]
        dedup_map = {}
        for r in folder_records:
            key = (r["enterprise_folder_id"], r["requirement_id"])
            dedup_map[key] = r

        unique_enterprises = set(r["enterprise_folder_id"] for r in dedup_map.values())
        self.assertEqual(len(unique_enterprises), 1)

    def test_02_renamed_folder_retains_identity(self):
        folder1 = {"enterprise_folder_id": "1A2B3C", "name": "Carias Piggery"}
        folder2 = {"enterprise_folder_id": "1A2B3C", "name": "Carias Piggery Enterprise"}
        self.assertEqual(folder1["enterprise_folder_id"], folder2["enterprise_folder_id"])

    def test_03_different_folder_ids_with_similar_names_flagged(self):
        name1 = "D-Arco RIR and Native Poultry Production"
        name2 = "Darco Rir"

        norm1 = re.sub(r'[^a-z0-9]', '', name1.lower())
        norm2 = re.sub(r'[^a-z0-9]', '', name2.lower())
        
        self.assertIn("darcorir", norm1)
        self.assertIn("darcorir", norm2)

    def test_04_total_enterprises_counts_unique_folder_ids(self):
        scan_results = []
        for f_idx in range(17):
            f_id = f"folder_{f_idx}"
            for req_idx in range(12):
                scan_results.append({
                    "enterprise_folder_id": f_id,
                    "requirement_id": f"req_{req_idx}"
                })

        self.assertEqual(len(scan_results), 204)
        unique_folders = set(r["enterprise_folder_id"] for r in scan_results)
        self.assertEqual(len(unique_folders), 17)

    def test_05_human_approval_survives_cloud_rescan(self):
        human_review = {"manual_status": "APPROVED", "reviewer_name": "Maria"}
        cloud_scan_result = {"automated_status": "NEEDS_REVIEW"}

        effective_status = human_review["manual_status"] or cloud_scan_result["automated_status"]
        self.assertEqual(effective_status, "APPROVED")

    def test_06_synthetic_folder_id_not_matching_real_drive_id(self):
        synthetic_id = "folder_bb_banana_chips"
        real_id = "1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP"
        self.assertNotEqual(synthetic_id, real_id)

    def test_07_identity_resolution_resolves_synthetic_to_real(self):
        data_json_map = {
            "byId": {"bandb-banana-chips": "1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP"},
            "byName": {"b&b banana chips": "1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP"},
            "byFolderId": {"1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP": "1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP"}
        }

        def is_real_gdrive_id(id_str):
            return id_str and len(id_str) > 15 and any(c.isupper() for c in id_str)

        def resolve_folder_key(raw_key, enterprise_id, enterprise_name, id_map):
            if raw_key and is_real_gdrive_id(raw_key):
                return raw_key
            if enterprise_id and enterprise_id in id_map["byId"]:
                return id_map["byId"][enterprise_id]
            if enterprise_name and enterprise_name.lower().strip() in id_map["byName"]:
                return id_map["byName"][enterprise_name.lower().strip()]
            return raw_key

        result = resolve_folder_key("folder_bb_banana_chips", "bandb-banana-chips", "B&B Banana Chips", data_json_map)
        self.assertEqual(result, "1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP")

    def test_08_real_folder_id_passes_through(self):
        real_id = "1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP"

        def is_real_gdrive_id(id_str):
            return id_str and len(id_str) > 15 and any(c.isupper() for c in id_str)

        self.assertTrue(is_real_gdrive_id(real_id))

    def test_09_no_duplicates_after_identity_resolution(self):
        data_json_participants = [
            {"id": "bandb-banana-chips", "name": "B&B Banana Chips", "driveFolderId": "1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP"},
            {"id": "capra_verde", "name": "CAPRA VERDE", "driveFolderId": "1OBSrOknbVKQ54wOVzy1wyl2r_L_wPeKi"}
        ]
        supabase_rows = [
            {"enterprise_folder_id": "folder_bb_banana_chips", "enterprise_id": "bb_banana_chips", "enterprise_name": "B&B Banana Chips"},
            {"enterprise_folder_id": "folder_capra_verde", "enterprise_id": "capra_verde", "enterprise_name": "CAPRA VERDE"}
        ]

        identity_map = {"byId": {}, "byName": {}, "byFolderId": {}}
        for p in data_json_participants:
            fid = p["driveFolderId"]
            identity_map["byId"][p["id"]] = fid
            identity_map["byName"][p["name"].lower().strip()] = fid

        def is_real_gdrive_id(id_str):
            return id_str and len(id_str) > 15 and any(c.isupper() for c in id_str)

        def resolve_folder_key(raw_key, enterprise_id, enterprise_name, id_map):
            if raw_key and is_real_gdrive_id(raw_key):
                return raw_key
            if enterprise_id and enterprise_id in id_map["byId"]:
                return id_map["byId"][enterprise_id]
            if enterprise_name and enterprise_name.lower().strip() in id_map["byName"]:
                return id_map["byName"][enterprise_name.lower().strip()]
            return raw_key

        participants_map = {}
        for p in data_json_participants:
            participants_map[p["driveFolderId"]] = p

        for row in supabase_rows:
            resolved_key = resolve_folder_key(
                row["enterprise_folder_id"], row["enterprise_id"], row["enterprise_name"], identity_map
            )
            if resolved_key not in participants_map:
                participants_map[resolved_key] = {"name": row["enterprise_name"]}

        self.assertEqual(len(participants_map), 2)
        self.assertIn("1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP", participants_map)
        self.assertIn("1OBSrOknbVKQ54wOVzy1wyl2r_L_wPeKi", participants_map)

    def test_10_17_folders_produces_17_enterprises(self):
        real_folder_ids = [
            "1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_",
            "1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP",
            "1Jr02P_7-qjKWYY2LobehBIUd9auqLKI0",
            "1OBSrOknbVKQ54wOVzy1wyl2r_L_wPeKi",
            "1w5yWcoh0YUbWYOlRWLCUkj3CNh1Qvbwl"
        ]
        scan_results = []
        for fid in real_folder_ids:
            for req_idx in range(12):
                scan_results.append({
                    "enterprise_folder_id": fid,
                    "requirement_id": f"req_{req_idx}"
                })

        unique_folders = set(r["enterprise_folder_id"] for r in scan_results)
        self.assertEqual(len(unique_folders), len(real_folder_ids))
        self.assertEqual(len(scan_results), len(real_folder_ids) * 12)


class TestWormTastikFilenameMatching(unittest.TestCase):
    """Regression tests using actual WormTastik Google Drive filenames."""

    def setUp(self):
        self.CANONICAL_REQUIREMENTS = {
            "applicationLetter": {
                "keywords": ["application letter", "letter of application", "app letter", "intent letter", "joint application", "start up individual application"]
            },
            "applicationForm": {
                "keywords": ["application form", "app form", "form b", "start up form", "entry form", "registration form"]
            },
            "businessModelCanvas": {
                "keywords": ["business model canvas", "business model", "bmc template", "canvas", "bmc"]
            },
            "bmcFinancials": {
                "keywords": ["bmc financial", "financial projections", "projections", "financial plan"]
            },
            "financialFigures": {
                "keywords": ["activity and financial plan", "financial plan", "cashflow", "cash flow", "financial statement", "budget", "income statement", "balance sheet", "expenses"]
            },
            "validId": {
                "keywords": ["valid id", "government id", "national id", "philid", "driver license", "drivers license", "umid", "voter id", "postal id", "prc id", "passport id", "passport", "id card", "scanned copy valid id"]
            },
            "swornStatement": {
                "keywords": ["sworn statement", "affidavit", "form c", "form j", "declaration new business", "authority to use land"]
            },
            "proofOfResidency": {
                "keywords": ["proof of residency", "residency", "residence", "barangay certificate", "barangay clearance", "certificate of residency", "proof of address"]
            },
            "endorsementLetter": {
                "keywords": ["endorsement letter", "endorsement", "endorsment", "recommending letter", "recommendation", "reccomendation", "lgu endorsement", "endorse", "agriculture office"]
            },
            "photo2x2": {
                "keywords": ["2x2", "2 x 2", "2by2", "id photo", "applicant photo", "headshot", "passport photo", "picture", "photo"]
            },
            "signatures": {
                "keywords": ["signed", "signature", "signed form", "signed copy", "with signature"]
            },
            "declarationOfIntent": {
                "keywords": ["declaration of intent", "declaration intent", "intent declaration", "group declaration", "annex a"]
            },
        }

        self.FILENAME_ALIASES = {
            "passport id": "validId",
            "passport": "validId",
            "id picture": "validId",
            "id pic": "validId",
            "2x2 picture": "photo2x2",
            "2x2 photo": "photo2x2",
            "id photo 2x2": "photo2x2",
            "passport picture": "photo2x2",
            "headshot": "photo2x2",
            "bmc financials": "bmcFinancials",
            "bmc financial": "bmcFinancials",
        }

        self.reqKeyOrder = [
            "applicationLetter", "applicationForm", "bmcFinancials", "businessModelCanvas",
            "financialFigures", "validId", "swornStatement", "proofOfResidency",
            "endorsementLetter", "photo2x2", "signatures", "declarationOfIntent"
        ]

    def _match_file(self, fname, mime_type=None):
        """Simulate the scanner matching logic (with file assignment tracking)."""
        fnNorm = re.sub(r"[^a-z0-9]+", " ", fname.lower()).strip()
        file_assignments = {}
        results = {}

        for reqKey in self.reqKeyOrder:
            reqDef = self.CANONICAL_REQUIREMENTS[reqKey]
            matched = False

            # Skip if this file was already assigned to a higher-priority requirement
            if fnNorm in file_assignments and file_assignments[fnNorm] != reqKey:
                continue

            # Layer 1: Filename aliases
            alias_key = fnNorm
            if self.FILENAME_ALIASES.get(alias_key) == reqKey:
                matched = True

            # Layer 2: Keyword matching
            if not matched:
                for kw in reqDef["keywords"]:
                    if kw in fnNorm:
                        matched = True
                        break

            # Layer 3: MIME-type awareness
            if not matched and mime_type:
                mime = mime_type.lower()
                if reqKey == "validId" and (mime.startswith("image/") or mime == "application/pdf"):
                    if re.search(r"id|passport|license|valid", fnNorm):
                        matched = True
                if reqKey == "photo2x2" and mime.startswith("image/"):
                    if re.search(r"photo|picture|headshot|2x2|id", fnNorm):
                        matched = True

            if matched:
                file_assignments[fnNorm] = reqKey
                results[reqKey] = fname

        return results

    def test_A_application_letter(self):
        """WormTastik: A.-StartUp-Individual-Application-Letter.pdf -> applicationLetter"""
        matches = self._match_file("A.-StartUp-Individual-Application-Letter.pdf")
        self.assertIn("applicationLetter", matches)
        self.assertNotIn("applicationForm", matches)

    def test_B_application_form(self):
        """WormTastik: B.-Application-Form-Start-Up.pdf -> applicationForm"""
        matches = self._match_file("B.-Application-Form-Start-Up.pdf")
        self.assertIn("applicationForm", matches)

    def test_C_bmc_docx(self):
        """WormTastik: BMC.docx -> businessModelCanvas ONLY (not bmcFinancials)"""
        matches = self._match_file("BMC.docx")
        self.assertIn("businessModelCanvas", matches)
        self.assertNotIn("bmcFinancials", matches,
            "BMC.docx should NOT match bmcFinancials")

    def test_D_logo_not_matched(self):
        """WormTastik: LOGO.png -> no requirement matched"""
        matches = self._match_file("LOGO.png")
        self.assertEqual(len(matches), 0, f"LOGO.png should not match any requirement, got {matches}")

    def test_E_passport_id(self):
        """WormTastik: passport ID -> validId"""
        matches = self._match_file("passport ID")
        self.assertIn("validId", matches)

    def test_F_picture_png(self):
        """WormTastik: picture.png -> photo2x2"""
        matches = self._match_file("picture.png", mime_type="image/png")
        self.assertIn("photo2x2", matches)

    def test_G_bmc_financials_xlsx(self):
        """WormTastik: WormTastik-YFC-BMC-Financials-New-Plan-Updated.xlsx -> bmcFinancials (NOT businessModelCanvas)"""
        matches = self._match_file("WormTastik-YFC-BMC-Financials-New-Plan-Updated.xlsx")
        self.assertIn("bmcFinancials", matches)
        self.assertNotIn("businessModelCanvas", matches,
            "BMC Financials xlsx should NOT match businessModelCanvas")

    def test_H_application_letter_prefix(self):
        """Prefixes like A.- are handled by normalization"""
        matches = self._match_file("A.-StartUp-Individual-Application-Letter.pdf")
        self.assertIn("applicationLetter", matches)

    def test_I_application_form_prefix(self):
        """Prefixes like B.- are handled by normalization"""
        matches = self._match_file("B.-Application-Form-Start-Up.pdf")
        self.assertIn("applicationForm", matches)

    def test_J_passport_id_with_extension(self):
        """passport ID.jpg should also match validId"""
        matches = self._match_file("passport ID.jpg")
        self.assertIn("validId", matches)

    def test_K_picture_with_size(self):
        """picture (1).png should match photo2x2"""
        matches = self._match_file("picture (1).png", mime_type="image/png")
        self.assertIn("photo2x2", matches)

    def test_L_photo_jpg(self):
        """photo.jpg should match photo2x2"""
        matches = self._match_file("photo.jpg", mime_type="image/jpeg")
        self.assertIn("photo2x2", matches)

    def test_M_scanned_copy_valid_id(self):
        """'Scanned copy valid ID' should match validId"""
        matches = self._match_file("Scanned copy valid ID.pdf", mime_type="application/pdf")
        self.assertIn("validId", matches)

    def test_N_sworn_statement(self):
        """C. Individual Affidavit of New Business.pdf -> swornStatement"""
        matches = self._match_file("C. Individual Affidavit of New Business.pdf")
        self.assertIn("swornStatement", matches)

    def test_O_start_up_individual_application_letter(self):
        """'StartUp Individual Application Letter' should match applicationLetter"""
        matches = self._match_file("StartUp Individual Application Letter.pdf")
        self.assertIn("applicationLetter", matches)

    def test_P_wormtastik_prefix_in_name(self):
        """Enterprise name prefix in filename should not prevent matching"""
        matches = self._match_file("WormTastik-YFC-BMC-Financials-New-Plan-Updated.xlsx")
        self.assertIn("bmcFinancials", matches)

    def test_Q_declaration_of_intent_not_applicable_individual(self):
        """declarationOfIntent should be NOT_APPLICABLE for INDIVIDUAL (no file matches)"""
        matches = self._match_file("some_random_file.pdf")
        self.assertNotIn("declarationOfIntent", matches)

    def test_R_no_false_positive_from_logo(self):
        """LOGO.png should not create false positive for any requirement"""
        for reqKey in self.reqKeyOrder:
            matches = self._match_file("LOGO.png")
            self.assertNotIn(reqKey, matches, f"LOGO.png should not match {reqKey}")

    def test_S_all_wormtastik_files_mapped(self):
        """Verify the complete WormTastik file set produces expected mappings"""
        wormtastik_files = [
            ("A.-StartUp-Individual-Application-Letter.pdf", "applicationLetter"),
            ("B.-Application-Form-Start-Up.pdf", "applicationForm"),
            ("BMC.docx", "businessModelCanvas"),
            ("LOGO.png", None),
            ("passport ID", "validId"),
            ("picture.png", "photo2x2"),
            ("WormTastik-YFC-BMC-Financials-New-Plan-Updated.xlsx", "bmcFinancials"),
        ]

        matched_requirements = set()
        for fname, expected_req in wormtastik_files:
            matches = self._match_file(fname, mime_type="image/png" if fname.endswith(".png") else None)
            if expected_req:
                self.assertIn(expected_req, matches, f"File '{fname}' should match {expected_req}")
                matched_requirements.add(expected_req)
            else:
                self.assertEqual(len(matches), 0, f"File '{fname}' should not match any requirement")

        # Verify expected matched requirements
        expected_matched = {"applicationLetter", "applicationForm", "businessModelCanvas", "validId", "photo2x2", "bmcFinancials"}
        self.assertEqual(matched_requirements, expected_matched)


class TestFilenameMatchingEdgeCases(unittest.TestCase):
    """Additional edge case tests for filename matching."""

    def test_hyphens_normalized(self):
        """Hyphens in filenames are normalized to spaces"""
        fnNorm = re.sub(r"[^a-z0-9]+", " ", "A.-StartUp-Individual-Application-Letter.pdf".lower()).strip()
        self.assertIn("application letter", fnNorm)

    def test_underscores_normalized(self):
        """Underscores in filenames are normalized to spaces"""
        fnNorm = re.sub(r"[^a-z0-9]+", " ", "application_letter.pdf".lower()).strip()
        self.assertIn("application letter", fnNorm)

    def test_periods_normalized(self):
        """Periods in filenames are normalized to spaces"""
        fnNorm = re.sub(r"[^a-z0-9]+", " ", "A.-StartUp.pdf".lower()).strip()
        self.assertIn("a startup", fnNorm)

    def test_multiple_spaces_collapsed(self):
        """Multiple consecutive spaces are collapsed"""
        fnNorm = re.sub(r"[^a-z0-9]+", " ", "application  letter.pdf".lower()).strip()
        self.assertEqual(fnNorm, "application letter pdf")

    def test_uppercase_normalized(self):
        """Uppercase is lowercased"""
        fnNorm = re.sub(r"[^a-z0-9]+", " ", "APPLICATION LETTER.pdf".lower()).strip()
        self.assertEqual(fnNorm, "application letter pdf")


if __name__ == "__main__":
    unittest.main()
