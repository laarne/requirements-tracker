import unittest
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api'))


class TestContentPatterns(unittest.TestCase):
    """Test content-based document matching."""

    def test_residency_certificate_by_filename(self):
        from content_matcher_test import match_by_filename
        result = match_by_filename("certificate-of-residency.jpg", "proofOfResidency")
        self.assertGreater(result['score'], 0.3, "Certificate of residency should match proofOfResidency by filename")

    def test_residency_by_content(self):
        from content_matcher_test import match_by_content
        result = match_by_content("barangay certificate", "This is to certify that Juan Dela Cruz is a resident of Barangay San Isidro, Cabadbaran City.")
        self.assertGreater(result['score'], 0.3, "Barangay certificate content should match proofOfResidency")

    def test_application_letter_by_content(self):
        from content_matcher_test import match_by_content
        result = match_by_content("random-doc.pdf", "We are formally applying for the Young Farmers Challenge Program. Please accept this application letter.")
        self.assertGreater(result['score'], 0.3, "Application letter content should match applicationLetter")

    def test_financial_by_content(self):
        from content_matcher_test import match_by_content
        result = match_by_content("expenses.xlsx", "Operating expenses: Seeds PHP 5000, Fertilizer PHP 3000, Labor PHP 10000. Total monthly expense: PHP 18000.")
        self.assertGreater(result['score'], 0.3, "Financial content should match financialFigures")

    def test_joint_start_group_evidence(self):
        from content_matcher_test import classify_group
        result = classify_group("Joint Start-up Agreement between Juan Dela Cruz and Pedro Santos.")
        self.assertEqual(result, "GROUP", "Joint start-up should classify as GROUP")

    def test_individual_evidence(self):
        from content_matcher_test import classify_group
        result = classify_group("Individual application form for sole proprietor business.")
        self.assertEqual(result, "INDIVIDUAL", "Individual application should classify as INDIVIDUAL")

    def test_ambiguous_evidence(self):
        from content_matcher_test import classify_group
        result = classify_group("Business plan for agricultural venture.")
        self.assertEqual(result, "UNKNOWN", "Ambiguous evidence should classify as UNKNOWN")

    def test_valid_id_by_content(self):
        from content_matcher_test import match_by_content
        result = match_by_content("MORALES-id.jpg", "Republic of the Philippines. Philippine Identification System. Name: JUAN MORALES. Date of Birth: January 1, 1990. ID Number: PSA-12345678.")
        self.assertGreater(result['score'], 0.3, "ID content should match validId")

    def test_endorsement_by_content(self):
        from content_matcher_test import match_by_content
        result = match_by_content("endorsement.docx", "We hereby endorse and support the application of Juan Dela Cruz for the Young Farmers Challenge Program. Signed, Municipal Agriculture Office.")
        self.assertGreater(result['score'], 0.3, "Endorsement content should match endorsementLetter")

    def test_bmc_by_content(self):
        from content_matcher_test import match_by_content
        result = match_by_content("business-model.pdf", "Business Model Canvas. Key Partners: Local farmers. Key Activities: Organic farming. Value Proposition: Fresh produce. Customer Segments: Local restaurants. Revenue Stream: Sales.")
        self.assertGreater(result['score'], 0.3, "BMC content should match businessModelCanvas")


if __name__ == '__main__':
    unittest.main()
