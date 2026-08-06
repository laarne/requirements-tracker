import unittest
import json
import os
import sys

# Import recalculate_enterprise_scores from parent scratch directory
scratch_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if scratch_dir not in sys.path:
    sys.path.insert(0, scratch_dir)

from test_group_compliance_full import recalculate_enterprise_scores, CANONICAL_REQUIREMENTS

class TestFlagIssueWorkflow(unittest.TestCase):

    def setUp(self):
        # Sample INDIVIDUAL enterprise dataset
        self.individual_enterprise = {
            "id": "indiv_1",
            "name": "Testing Enterprise",
            "applicantType": "INDIVIDUAL",
            "requirements": {
                "applicationLetter": {"status": "COMPLETE", "files": [{"name": "Application Letter.pdf", "confidence": 0.95}]},
                "applicationForm": {"status": "COMPLETE", "files": [{"name": "Application Form.pdf", "confidence": 0.95}]},
                "businessModelCanvas": {"status": "COMPLETE", "files": [{"name": "BMC.pdf", "confidence": 0.95}]},
                "bmcFinancials": {"status": "COMPLETE", "files": [{"name": "BMC Financials.pdf", "confidence": 0.95}]},
                "financialFigures": {"status": "COMPLETE", "files": [{"name": "Financials.pdf", "confidence": 0.95}]},
                "validId": {"status": "COMPLETE", "files": [{"name": "Valid ID.jpg", "confidence": 0.95}]},
                "swornStatement": {"status": "COMPLETE", "files": [{"name": "Sworn Statement.pdf", "confidence": 0.95}]},
                "proofOfResidency": {"status": "COMPLETE", "files": [{"name": "Residency.jpg", "confidence": 0.95}]},
                "endorsementLetter": {"status": "COMPLETE", "files": [{"name": "Endorsement.pdf", "confidence": 0.95}]},
                "photo2x2": {"status": "COMPLETE", "files": [{"name": "2x2 Photo.jpg", "confidence": 0.95}]},
                "signatures": {"status": "COMPLETE", "files": [{"name": "Signatures.pdf", "confidence": 0.95}]},
                "declarationOfIntent": {"status": "NOT_APPLICABLE", "files": []}
            }
        }

        # Sample GROUP enterprise dataset (Bittersweet Bites: 3 members MADES, PEPITO, PULI)
        self.group_enterprise = {
            "id": "group_1",
            "name": "Bittersweet Bites",
            "applicantType": "GROUP",
            "requirements": {
                "applicationLetter": {"status": "COMPLETE", "files": [{"name": "Application Letter.pdf", "confidence": 0.95}]},
                "applicationForm": {"status": "MISSING", "files": []},
                "businessModelCanvas": {"status": "COMPLETE", "files": [{"name": "BMC.pdf", "confidence": 0.95}]},
                "bmcFinancials": {"status": "MISSING", "files": []},
                "financialFigures": {"status": "MISSING", "files": []},
                "swornStatement": {"status": "COMPLETE", "files": [{"name": "Sworn Statement.pdf", "confidence": 0.95}]},
                "endorsementLetter": {"status": "COMPLETE", "files": [{"name": "Endorsement.pdf", "confidence": 0.95}]},
                "signatures": {"status": "MISSING", "files": []},
                "declarationOfIntent": {"status": "COMPLETE", "files": [{"name": "Declaration.pdf", "confidence": 0.95}]},
                "validId": {
                    "status": "COMPLETE",
                    "files": [
                        {"name": "Valid ID MADES.jpg", "memberName": "MADES", "confidence": 0.95},
                        {"name": "Valid ID PEPITO.jpg", "memberName": "PEPITO", "confidence": 0.95},
                        {"name": "Valid ID PULI.jpg", "memberName": "PULI", "confidence": 0.95}
                    ]
                },
                "proofOfResidency": {
                    "status": "COMPLETE",
                    "files": [
                        {"name": "Residency MADES.jpg", "memberName": "MADES", "confidence": 0.95},
                        {"name": "Residency PEPITO.jpg", "memberName": "PEPITO", "confidence": 0.95},
                        {"name": "Residency PULI.jpg", "memberName": "PULI", "confidence": 0.95}
                    ]
                },
                "photo2x2": {
                    "status": "COMPLETE",
                    "files": [
                        {"name": "2x2 MADES.jpg", "memberName": "MADES", "confidence": 0.95},
                        {"name": "2x2 PEPITO.jpg", "memberName": "PEPITO", "confidence": 0.95},
                        {"name": "2x2 PULI.jpg", "memberName": "PULI", "confidence": 0.95}
                    ]
                }
            }
        }

    def test_flag_issue_complete_to_needs_review_transition(self):
        """Test transitioning COMPLETE requirement to NEEDS_REVIEW preserves evidence and updates scores."""
        res_before = recalculate_enterprise_scores(self.individual_enterprise)
        self.assertEqual(res_before["scores"]["complete"], 11)
        self.assertEqual(res_before["scores"]["needsReview"], 0)
        self.assertEqual(res_before["scores"]["percentage"], 100.0)

        # Flag issue on Application Letter
        self.individual_enterprise["requirements"]["applicationLetter"]["status"] = "NEEDS_REVIEW"
        res_after = recalculate_enterprise_scores(self.individual_enterprise)

        # 1. Status transition
        self.assertEqual(res_after["requirements"]["applicationLetter"]["status"], "NEEDS_REVIEW")

        # 2. Original evidence remains intact (files array not cleared)
        self.assertEqual(len(res_after["requirements"]["applicationLetter"]["files"]), 1)
        self.assertEqual(res_after["requirements"]["applicationLetter"]["files"][0]["name"], "Application Letter.pdf")

        # 3. Complete count decreases, needsReview count increases
        self.assertEqual(res_after["scores"]["complete"], 10)
        self.assertEqual(res_after["scores"]["needsReview"], 1)
        self.assertEqual(res_after["scores"]["percentage"], 90.9)

    def test_group_member_specific_flagging(self):
        """Test flagging issue for PEPITO's Valid ID leaves MADES and PULI complete."""
        res_before = recalculate_enterprise_scores(self.group_enterprise)
        self.assertEqual(res_before["scores"]["total"], 18)
        self.assertEqual(res_before["scores"]["complete"], 14)
        self.assertEqual(res_before["scores"]["needsReview"], 0)
        self.assertEqual(res_before["scores"]["percentage"], 77.8)

        # Flag PEPITO's Valid ID specifically
        overrides = {
            "validId_PEPITO": "NEEDS_REVIEW"
        }

        res_after = recalculate_enterprise_scores(self.group_enterprise, overrides=overrides)

        # Verify PEPITO's member status is NEEDS_REVIEW
        self.assertEqual(res_after["memberDetails"]["PEPITO"]["validId"]["status"], "NEEDS_REVIEW")

        # Verify MADES and PULI remain COMPLETE
        self.assertEqual(res_after["memberDetails"]["MADES"]["validId"]["status"], "COMPLETE")
        self.assertEqual(res_after["memberDetails"]["PULI"]["validId"]["status"], "COMPLETE")

        # Verify requirement-level category becomes NEEDS_REVIEW
        self.assertEqual(res_after["requirements"]["validId"]["status"], "NEEDS_REVIEW")

        # Verify scores recalculate accurately based on affected slot only
        self.assertEqual(res_after["scores"]["complete"], 13)  # 14 - 1
        self.assertEqual(res_after["scores"]["needsReview"], 1)
        self.assertEqual(res_after["scores"]["percentage"], 72.2)  # 13/18

        # Original file evidence remains intact for all members
        self.assertEqual(len(res_after["requirements"]["validId"]["files"]), 3)

    def test_evidence_never_deleted_on_flag(self):
        """Test that evidence files array is never modified or destroyed when flagging issue."""
        self.individual_enterprise["requirements"]["businessModelCanvas"]["status"] = "NEEDS_REVIEW"
        res = recalculate_enterprise_scores(self.individual_enterprise)
        bmc_doc = res["requirements"]["businessModelCanvas"]

        self.assertEqual(bmc_doc["status"], "NEEDS_REVIEW")
        self.assertIsNotNone(bmc_doc["files"])
        self.assertGreater(len(bmc_doc["files"]), 0)
        self.assertEqual(bmc_doc["files"][0]["name"], "BMC.pdf")

if __name__ == "__main__":
    unittest.main()
