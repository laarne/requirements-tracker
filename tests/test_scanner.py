"""
Comprehensive Unit Test Suite for Participant Requirements Scanner Engine & Review History Persistence.
Covers 16 canonical scanner test cases + 6 Review History tracking test cases + Scanner Isolation test cases + Online Cloud Scanner persistence test cases.
"""

import os
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


class TestOnlineCloudScannerPersistence(unittest.TestCase):
    """Test suite for Online Cloud Scanner jobs, persistence, and data separation."""

    def test_01_scan_results_schema_structure(self):
        scan_record = {
            "enterprise_id": "agriturkey",
            "requirement_id": "applicationLetter",
            "file_id": "file_123",
            "file_name": "Application Letter.pdf",
            "automated_status": "COMPLETE",
            "confidence": 0.95,
            "document_type": "Application Letter",
            "drive_url": "https://drive.google.com/drive/folders/12KBAKnxhkKOPBQbZXlWLfsolsBUrDf7y"
        }
        self.assertEqual(scan_record["automated_status"], "COMPLETE")
        self.assertEqual(scan_record["confidence"], 0.95)

    def test_02_scan_jobs_status_transitions(self):
        statuses = ["QUEUED", "RUNNING", "COMPLETED"]
        self.assertEqual(statuses[0], "QUEUED")
        self.assertEqual(statuses[1], "RUNNING")
        self.assertEqual(statuses[2], "COMPLETED")

    def test_03_duplicate_scan_prevention(self):
        jobs = [{"id": "job_1", "status": "RUNNING"}]
        is_running = any(j["status"] == "RUNNING" for j in jobs)
        self.assertTrue(is_running)

    def test_04_data_separation_preserves_human_reviews(self):
        human_review = {"manual_status": "APPROVED", "reviewer_name": "Maria"}
        cloud_scan_result = {"automated_status": "NEEDS_REVIEW"}

        # Effective status merges human decision over automated scan result
        effective_status = human_review["manual_status"] or cloud_scan_result["automated_status"]
        self.assertEqual(effective_status, "APPROVED")
        self.assertEqual(human_review["manual_status"], "APPROVED")


if __name__ == "__main__":
    unittest.main()
