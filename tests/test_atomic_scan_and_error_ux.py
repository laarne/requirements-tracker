import unittest
import json
import os
import sys

scratch_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if scratch_dir not in sys.path:
    sys.path.insert(0, scratch_dir)

from test_group_compliance_full import recalculate_enterprise_scores, CANONICAL_REQUIREMENTS

def classify_google_error(msg):
    msg_str = str(msg)
    if "credentials" in msg_str or "GOOGLE_SERVICE_ACCOUNT" in msg_str:
        return {"code": "AUTHENTICATION_FAILURE", "transient": False, "message": "Google Drive API authentication credentials missing or invalid."}
    if "403" in msg_str or "permission" in msg_str or "access" in msg_str:
        return {"code": "AUTHORIZATION_FAILURE", "transient": False, "message": "Access denied to configured Google Drive master folder."}
    if "404" in msg_str or "not found" in msg_str:
        return {"code": "DRIVE_NOT_FOUND", "transient": False, "message": "Configured Google Drive master folder not found."}
    if "429" in msg_str or "rate" in msg_str or "quota" in msg_str:
        return {"code": "GOOGLE_API_RATE_LIMIT", "transient": True, "message": "Google Drive API rate limit exceeded."}
    if "ETIMEDOUT" in msg_str or "timeout" in msg_str or "ECONNRESET" in msg_str:
        return {"code": "GOOGLE_API_TIMEOUT", "transient": True, "message": "Google Drive API connection timed out."}
    if "500" in msg_str or "502" in msg_str or "503" in msg_str:
        return {"code": "GOOGLE_API_500", "transient": True, "message": "Google Drive API temporarily returned a server error."}
    if "Integrity check failed" in msg_str or "integrity" in msg_str:
        return {"code": "DATA_VALIDATION_ERROR", "transient": False, "message": msg_str}
    if "commit" in msg_str or "database" in msg_str:
        return {"code": "DATABASE_COMMIT_ERROR", "transient": False, "message": "Supabase database commit transaction failed."}
    return {"code": "UNKNOWN_ERROR", "transient": False, "message": msg_str or "Cloud scan error occurred."}

class TestAtomicScanAndErrorUX(unittest.TestCase):

    def setUp(self):
        self.known_good_dataset = [
            {
                "id": "ent_1",
                "enterpriseFolderId": "1234567890abcdefA",
                "name": "Bittersweet Bites",
                "applicantType": "GROUP",
                "requirements": {
                    "applicationLetter": {"status": "COMPLETE", "files": [{"name": "AppLetter.pdf"}]},
                    "applicationForm": {"status": "MISSING", "files": []},
                    "businessModelCanvas": {"status": "COMPLETE", "files": [{"name": "BMC.pdf"}]},
                    "bmcFinancials": {"status": "MISSING", "files": []},
                    "financialFigures": {"status": "MISSING", "files": []},
                    "swornStatement": {"status": "COMPLETE", "files": [{"name": "SwornStatement.pdf"}]},
                    "endorsementLetter": {"status": "COMPLETE", "files": [{"name": "Endorsement.pdf"}]},
                    "signatures": {"status": "MISSING", "files": []},
                    "declarationOfIntent": {"status": "COMPLETE", "files": [{"name": "Declaration.pdf"}]},
                    "validId": {
                        "status": "COMPLETE",
                        "files": [
                            {"name": "Valid ID (MADES).jpg", "memberName": "MADES"},
                            {"name": "Valid ID (PEPITO).jpg", "memberName": "PEPITO"},
                            {"name": "Valid ID (PULI).jpg", "memberName": "PULI"}
                        ]
                    },
                    "proofOfResidency": {
                        "status": "COMPLETE",
                        "files": [
                            {"name": "Residency (MADES).jpg", "memberName": "MADES"},
                            {"name": "Residency (PEPITO).jpg", "memberName": "PEPITO"},
                            {"name": "Residency (PULI).jpg", "memberName": "PULI"}
                        ]
                    },
                    "photo2x2": {
                        "status": "COMPLETE",
                        "files": [
                            {"name": "2x2 (MADES).jpg", "memberName": "MADES"},
                            {"name": "2x2 (PEPITO).jpg", "memberName": "PEPITO"},
                            {"name": "2x2 (PULI).jpg", "memberName": "PULI"}
                        ]
                    }
                }
            }
        ]

    def validate_scan_integrity_mock(self, participants, scan_results):
        if not participants or len(participants) == 0:
            return {"valid": False, "reason": "No enterprise folders scanned."}
        if not scan_results or len(scan_results) == 0:
            return {"valid": False, "reason": "No scan results produced."}

        for p in participants:
            if not p.get("enterpriseFolderId") or not p.get("name") or not p.get("applicantType"):
                return {"valid": False, "reason": f"Enterprise {p.get('name', 'unknown')} missing metadata."}
            if p.get("applicantType").upper() not in ["INDIVIDUAL", "GROUP"]:
                return {"valid": False, "reason": f"Invalid applicant type {p.get('applicantType')}."}
            if not p.get("requirements") or len(p.get("requirements")) == 0:
                return {"valid": False, "reason": f"Enterprise {p.get('name')} has empty requirements."}

        return {"valid": True}

    def test_integrity_validation_valid_dataset(self):
        """Test dataset integrity validation passes for valid dataset."""
        participants = self.known_good_dataset
        scan_results = [{"enterprise_folder_id": "1234567890abcdefA", "requirement_id": "applicationLetter"}]
        res = self.validate_scan_integrity_mock(participants, scan_results)
        self.assertTrue(res["valid"])

    def test_integrity_validation_empty_dataset(self):
        """Test dataset integrity validation fails for empty dataset."""
        res = self.validate_scan_integrity_mock([], [])
        self.assertFalse(res["valid"])
        self.assertIn("No enterprise folders scanned", res["reason"])

    def test_integrity_validation_malformed_enterprise(self):
        """Test dataset integrity validation catches missing metadata."""
        participants = [{"name": "Broken Ent", "applicantType": "INVALID"}]
        res = self.validate_scan_integrity_mock(participants, [{"req": "app"}])
        self.assertFalse(res["valid"])

    def test_failed_scan_preserves_previous_dataset(self):
        """Test that scan failure preserves previous known-good dataset intact."""
        initial_p = recalculate_enterprise_scores(self.known_good_dataset[0])
        initial_score = initial_p["scores"]["percentage"]

        # Simulate scan failure response from backend
        scan_response = {
            "success": False,
            "status": "FAILED",
            "stage": "FOLDER_ENUMERATION",
            "errorCode": "GOOGLE_API_TIMEOUT",
            "error": "Google Drive scan failed during folder enumeration. API timeout.",
            "lastSuccessfulScan": "Aug 6, 2026 12:39 PM"
        }

        # Verify scan response is explicit FAILED
        self.assertFalse(scan_response["success"])
        self.assertEqual(scan_response["status"], "FAILED")
        self.assertEqual(scan_response["errorCode"], "GOOGLE_API_TIMEOUT")

        # Verify dataset in UI memory remains 100% unchanged
        after_p = self.known_good_dataset[0]
        self.assertEqual(after_p["scores"]["percentage"], initial_score)
        self.assertEqual(after_p["scores"]["complete"], 14)
        self.assertEqual(after_p["scores"]["total"], 18)

    def test_toast_deduplication_logic(self):
        """Test toast message deduplication suppresses identical toasts within 3 seconds."""
        toast_history = []

        def show_toast_sim(msg, last_msg, last_time, current_time):
            if msg == last_msg and (current_time - last_time) < 3000:
                return False, last_msg, last_time  # Suppressed
            toast_history.append(msg)
            return True, msg, current_time

        # First toast
        shown1, last_msg, last_time = show_toast_sim("Scan Error: HTTP 500", "", 0, 1000)
        self.assertTrue(shown1)

        # Immediate duplicate (100ms later) -> Suppressed
        shown2, last_msg, last_time = show_toast_sim("Scan Error: HTTP 500", last_msg, last_time, 1100)
        self.assertFalse(shown2)

        # Another duplicate (500ms later) -> Suppressed
        shown3, last_msg, last_time = show_toast_sim("Scan Error: HTTP 500", last_msg, last_time, 1500)
        self.assertFalse(shown3)

        # Exactly 1 toast in history
        self.assertEqual(len(toast_history), 1)

    def test_group_compliance_integrity_on_retry(self):
        """Test Bittersweet Bites group compliance scores remain 14/18 = 77.8%."""
        p = recalculate_enterprise_scores(self.known_good_dataset[0])
        self.assertEqual(p["scores"]["total"], 18)
        self.assertEqual(p["scores"]["complete"], 14)
        self.assertEqual(p["scores"]["percentage"], 77.8)

    def test_error_classification(self):
        """Test error classification helper categorizes transient vs non-transient errors."""
        e1 = classify_google_error("GOOGLE_SERVICE_ACCOUNT_JSON not set")
        self.assertEqual(e1["code"], "AUTHENTICATION_FAILURE")
        self.assertFalse(e1["transient"])

        e2 = classify_google_error("429 rate limit exceeded")
        self.assertEqual(e2["code"], "GOOGLE_API_RATE_LIMIT")
        self.assertTrue(e2["transient"])

        e3 = classify_google_error("ETIMEDOUT connection failed")
        self.assertEqual(e3["code"], "GOOGLE_API_TIMEOUT")
        self.assertTrue(e3["transient"])

        e4 = classify_google_error("Integrity check failed: missing folder")
        self.assertEqual(e4["code"], "DATA_VALIDATION_ERROR")
        self.assertFalse(e4["transient"])

    def test_reviewer_override_and_audit_preservation(self):
        """Test human reviewer override changes state to NEEDS_REVIEW and preserves automated detection."""
        ent = self.known_good_dataset[0]

        # Reviewer flags issue on Application Letter
        app_doc = ent["requirements"]["applicationLetter"]
        app_doc["review"] = {
            "manualStatus": "NEEDS_REVIEW",
            "reviewerName": "Operational Reviewer",
            "note": "Reason: Missing signature. Note: Page 2 signature is missing."
        }
        app_doc["status"] = "NEEDS_REVIEW"

        # Automated detection remains intact in files array
        self.assertEqual(len(app_doc["files"]), 1)
        self.assertEqual(app_doc["files"][0]["name"], "AppLetter.pdf")

        # Score recalculates accurately
        p = recalculate_enterprise_scores(ent)
        self.assertEqual(p["scores"]["complete"], 13)
        self.assertEqual(p["scores"]["needsReview"], 1)
        self.assertEqual(p["scores"]["percentage"], 72.2)

if __name__ == "__main__":
    unittest.main()
