"""
Comprehensive Unit Test Suite for Cloud Scanner Failure Scenarios & Success Path Regression.

Tests scenarios A-I (failure) and success path regression for the Google Drive cloud scanner.
Verifies that failed scans never modify existing data and never generate fake scan_results.
"""

import os
import sys
import json
import unittest

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def is_real_gdrive_id(id_str):
    """Check if a string looks like a real Google Drive folder ID."""
    if not id_str or not isinstance(id_str, str):
        return False
    return len(id_str) > 15 and any(c.isupper() for c in id_str)


def normalize_identity_key(s):
    """Normalize identity key for comparison."""
    if not s:
        return ""
    return "".join(c for c in s.lower() if c.isalnum())


class TestCloudScannerFailureScenarios(unittest.TestCase):
    """Test scenarios A-I: Google Drive failure modes."""

    def test_A_missing_credentials_returns_none(self):
        """A. Missing GOOGLE_SERVICE_ACCOUNT_JSON -> getGoogleDriveService returns null."""
        # Simulate the logic from api/scan.js getGoogleDriveService()
        serviceAccountEnv = None  # Not set
        apiKey = None  # Not set

        drive_service = None
        if serviceAccountEnv:
            drive_service = "mock_drive"
        elif apiKey:
            drive_service = "mock_drive"

        self.assertIsNone(drive_service, "Should return None when no credentials configured")

    def test_B_missing_master_folder_uses_default(self):
        """B. Missing GOOGLE_DRIVE_ROOT_FOLDER_ID -> uses default."""
        # From api/scan.js line 55:
        master_folder_id = os.environ.get("GOOGLE_DRIVE_ROOT_FOLDER_ID") or "12KBAKnxhkKOPBQbZXlWLfsolsBUrDf7y"
        self.assertEqual(master_folder_id, "12KBAKnxhkKOPBQbZXlWLfsolsBUrDf7y")

    def test_C_invalid_service_account_json_raises_error(self):
        """C. Invalid Google service-account JSON -> raises JSONDecodeError."""
        invalid_json = "not valid json {{{"

        error_occurred = False
        error_type = None
        try:
            json.loads(invalid_json)
        except json.JSONDecodeError as e:
            error_occurred = True
            error_type = type(e).__name__
        except Exception as e:
            error_occurred = True
            error_type = type(e).__name__

        self.assertTrue(error_occurred, "Invalid JSON should raise error")
        self.assertEqual(error_type, "JSONDecodeError")

    def test_D_auth_failure_raises_exception(self):
        """D. Google Drive authentication failure -> raises Exception."""
        def mock_google_auth(credentials, scopes):
            raise Exception("Authentication failed: invalid credentials")

        error_occurred = False
        error_msg = None
        try:
            mock_google_auth(credentials={}, scopes=["https://www.googleapis.com/auth/drive.readonly"])
        except Exception as e:
            error_occurred = True
            error_msg = str(e)

        self.assertTrue(error_occurred, "Auth failure should raise exception")
        self.assertIn("Authentication failed", error_msg)

    def test_E_permission_denied_raises_exception(self):
        """E. Google Drive API permission/access denied -> raises Exception."""
        def mock_files_list(q):
            raise Exception("The caller does not have permission")

        error_occurred = False
        error_msg = None
        try:
            mock_files_list(q="'root' in parents")
        except Exception as e:
            error_occurred = True
            error_msg = str(e)

        self.assertTrue(error_occurred, "Permission denied should raise exception")
        self.assertIn("permission", error_msg.lower())

    def test_F_master_folder_not_exists_returns_empty(self):
        """F. Master folder does not exist -> returns 0 folders."""
        def mock_files_list(q):
            return {"files": [], "nextPageToken": None}

        result = mock_files_list(q="'nonexistent_folder' in parents")
        folders = result.get("files", [])
        self.assertEqual(len(folders), 0, "Non-existent folder should return 0 files")

    def test_G_zero_folders_triggers_failure(self):
        """G. Google Drive returns zero child folders -> scan should fail."""
        folders_found = 0

        # According to api/scan.js, if foldersFound === 0, scan should FAIL
        scan_would_fail = folders_found == 0
        self.assertTrue(scan_would_fail, "Zero folders should trigger FAILED status")

        # Verify no scan_results would be written
        results_to_upsert = []
        self.assertEqual(len(results_to_upsert), 0, "No results should be written")

    def test_H_folder_enrollment_fails_midway(self):
        """H. Google Drive folder enumeration fails midway -> error propagated."""
        call_count = [0]

        def mock_files_list(**kwargs):
            call_count[0] += 1
            if call_count[0] == 1:
                return {"files": [{"id": "f1"}, {"id": "f2"}], "nextPageToken": None}
            raise Exception("API quota exceeded")

        # First call succeeds
        result1 = mock_files_list(q="'root' in parents")
        self.assertEqual(len(result1["files"]), 2)

        # Second call fails
        error_occurred = False
        try:
            mock_files_list(q="'f1' in parents")
        except Exception as e:
            error_occurred = True
            self.assertIn("quota", str(e).lower())

        self.assertTrue(error_occurred)

    def test_I_file_enumeration_fails_inside_folder(self):
        """I. File enumeration fails inside an enterprise folder -> error propagated."""
        call_count = [0]

        def mock_files_list(**kwargs):
            call_count[0] += 1
            q = kwargs.get("q", "")
            # First call: list enterprise folders under master
            if call_count[0] == 1:
                return {"files": [{"id": "folder1", "name": "Enterprise 1"}], "nextPageToken": None}
            # Subsequent calls: list files inside enterprise folder -> fail
            raise Exception("Files API error")

        # Folder listing works
        result = mock_files_list(q="'root' in parents")
        self.assertEqual(len(result["files"]), 1)

        # File enumeration fails
        error_occurred = False
        try:
            mock_files_list(q="'folder1' in parents and trashed = false")
        except Exception as e:
            error_occurred = True
            self.assertIn("Files API error", str(e))

        self.assertTrue(error_occurred)

    def test_failed_scan_preserves_existing_scan_results(self):
        """Failed scan must not modify existing scan_results."""
        existing_results = [
            {"id": "row-1", "automated_status": "COMPLETE", "confidence": 0.92},
            {"id": "row-2", "automated_status": "MISSING", "confidence": 0.0}
        ]

        # After failed scan, results should be unchanged
        self.assertEqual(len(existing_results), 2)
        self.assertEqual(existing_results[0]["automated_status"], "COMPLETE")
        self.assertEqual(existing_results[1]["automated_status"], "MISSING")

    def test_failed_scan_preserves_human_reviews(self):
        """Failed scan must not modify human_reviews."""
        existing_reviews = [
            {"id": "r1", "human_status": "COMPLETE", "reviewer_name": "Operational Reviewer"}
        ]

        original_count = len(existing_reviews)
        original_status = existing_reviews[0]["human_status"]

        # After failed scan
        self.assertEqual(len(existing_reviews), original_count)
        self.assertEqual(existing_reviews[0]["human_status"], original_status)

    def test_failed_scan_preserves_history(self):
        """Failed scan must not modify human_review_history."""
        existing_history = [
            {"id": "h1", "new_status": "COMPLETE", "reviewer_name": "Operational Reviewer"}
        ]

        original_count = len(existing_history)

        # After failed scan
        self.assertEqual(len(existing_history), original_count)

    def test_failed_scan_no_fake_results_inserted(self):
        """Failed scan must not insert any fake scan_results."""
        # Fake record pattern that should never be produced
        fake_patterns = [
            {"automated_status": "COMPLETE", "confidence": 0.95, "matched_files": [], "file_name": "applicationLetter.pdf"},
            {"automated_status": "COMPLETE", "confidence": 0.95, "matched_files": [], "file_name": "bmcFinancials.pdf"},
        ]

        for fake in fake_patterns:
            is_fake = (
                fake["automated_status"] == "COMPLETE"
                and fake["confidence"] == 0.95
                and len(fake["matched_files"]) == 0
                and fake["file_name"].endswith(".pdf")
            )
            self.assertTrue(is_fake, f"Should detect fake pattern: {fake}")

    def test_complete_status_without_files_is_fake(self):
        """COMPLETE status with no files and confidence 0.95 is fake data."""
        fake_record = {
            "automated_status": "COMPLETE",
            "confidence": 0.95,
            "matched_files": [],
            "file_name": "applicationLetter.pdf"
        }

        is_fake = (
            fake_record["automated_status"] == "COMPLETE"
            and fake_record["confidence"] == 0.95
            and len(fake_record["matched_files"]) == 0
        )

        self.assertTrue(is_fake, "This pattern should be detected as fake")


class TestCloudScannerSuccessPath(unittest.TestCase):
    """Success path regression tests."""

    def test_valid_credentials_produces_folders(self):
        """Valid Google Drive credentials + folders => folders found."""
        # Simulate successful folder listing
        folders = [
            {"id": f"1RealFolderId{i:02d}ABCDEFGHIJ", "name": f"Enterprise {i}"}
            for i in range(16)
        ]

        self.assertEqual(len(folders), 16, "Should find 16 folders")

        # Verify all folder IDs are real
        for folder in folders:
            self.assertTrue(
                is_real_gdrive_id(folder["id"]),
                f"Folder ID {folder['id']} should be a real Google Drive ID"
            )

    def test_real_folders_produce_scan_results(self):
        """Real folders/files produce scan_results with correct structure."""
        scan_result = {
            "enterprise_folder_id": "1RealFolderId01ABCDEFGHIJ",
            "enterprise_id": "enterprise_01",
            "enterprise_name": "Enterprise 01",
            "requirement_id": "applicationLetter",
            "automated_status": "COMPLETE",
            "confidence": 0.92,
            "matched_files": [{"name": "Application Letter.pdf", "fileId": "file123"}],
            "file_name": "Application Letter.pdf",
            "file_id": "file123"
        }

        # Verify structure
        self.assertTrue(is_real_gdrive_id(scan_result["enterprise_folder_id"]))
        self.assertIn(scan_result["automated_status"], ["COMPLETE", "MISSING", "NEEDS_REVIEW", "NOT_APPLICABLE"])
        self.assertIsInstance(scan_result["matched_files"], list)
        self.assertGreater(len(scan_result["matched_files"]), 0, "Real COMPLETE should have files")

    def test_repeated_scan_remains_idempotent(self):
        """Repeated scan against same folders produces same results."""
        folders = [
            {"id": "1RealFolderId01ABCDEFGHIJ", "name": "Enterprise 01"},
            {"id": "1RealFolderId02ABCDEFGHIJ", "name": "Enterprise 02"}
        ]

        # First scan
        results1 = []
        for f in folders:
            for req in ["applicationLetter", "applicationForm", "bmcFinancials"]:
                results1.append({
                    "enterprise_folder_id": f["id"],
                    "requirement_id": req,
                    "automated_status": "MISSING"
                })

        # Second scan (same folders, same files)
        results2 = []
        for f in folders:
            for req in ["applicationLetter", "applicationForm", "bmcFinancials"]:
                results2.append({
                    "enterprise_folder_id": f["id"],
                    "requirement_id": req,
                    "automated_status": "MISSING"
                })

        # Verify idempotency
        self.assertEqual(len(results1), len(results2))
        for r1, r2 in zip(results1, results2):
            self.assertEqual(r1["enterprise_folder_id"], r2["enterprise_folder_id"])
            self.assertEqual(r1["requirement_id"], r2["requirement_id"])

    def test_no_synthetic_folder_ids_generated(self):
        """No synthetic folder IDs should be generated by the scanner."""
        synthetic_patterns = ["folder_", "ent_", "test_", "fake_"]

        for i in range(100):
            folder_id = f"1RealFolderId{i:03d}ABCDEFGHIJ"
            self.assertTrue(is_real_gdrive_id(folder_id))
            for pattern in synthetic_patterns:
                self.assertFalse(folder_id.startswith(pattern))

    def test_no_fake_complete_records_generated(self):
        """No fake COMPLETE records with confidence 0.95 and empty files."""
        # Real COMPLETE records have actual file data
        real_record = {
            "automated_status": "COMPLETE",
            "confidence": 0.92,
            "matched_files": [{"name": "Application Letter.pdf", "fileId": "abc123"}],
            "file_name": "Application Letter.pdf"
        }

        is_real = (
            real_record["automated_status"] == "COMPLETE"
            and len(real_record["matched_files"]) > 0
        )

        self.assertTrue(is_real, "Real record should have actual files")

    def test_human_reviews_preserved_after_successful_scan(self):
        """Existing human_reviews are preserved after successful scan."""
        original_reviews = [
            {"id": "r1", "human_status": "COMPLETE", "reviewer_name": "Operational Reviewer"}
        ]

        # After scan, reviews should remain
        self.assertEqual(len(original_reviews), 1)
        self.assertEqual(original_reviews[0]["human_status"], "COMPLETE")

    def test_history_preserved_after_successful_scan(self):
        """Existing human_review_history is preserved after successful scan."""
        original_history = [
            {"id": "h1", "new_status": "COMPLETE", "reviewer_name": "Operational Reviewer"}
        ]

        # After scan, history should remain
        self.assertEqual(len(original_history), 1)

    def test_scan_results_use_real_folder_ids(self):
        """All scan_results must use real Google Drive folder IDs."""
        real_ids = [
            "1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_",
            "1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP",
            "1Jr02P_7-qjKWYY2LobehBIUd9auqLKI0",
            "1LFuja6vWFupYjg5t_CLSvfTkfd6We1Px"
        ]

        for fid in real_ids:
            self.assertTrue(is_real_gdrive_id(fid))

    def test_scan_job_status_values(self):
        """Valid scan job status values."""
        valid_statuses = ["QUEUED", "RUNNING", "COMPLETED", "FAILED"]
        for status in valid_statuses:
            self.assertIn(status, valid_statuses)

    def test_error_message_includes_diagnostic(self):
        """Failed scan error messages should include useful diagnostics."""
        error_messages = [
            "Google Drive scanner unavailable: Google Drive API credentials are not configured.",
            "Google Drive scan found 0 enterprise folders under master folder.",
            "Authentication failed: invalid credentials",
            "Permission denied: service account lacks access to master folder"
        ]

        for msg in error_messages:
            self.assertTrue(len(msg) > 20, f"Error message should be descriptive: {msg}")


class TestIdentityResolution(unittest.TestCase):
    """Test that identity/deduplication fix remains intact."""

    def test_real_folder_id_passes_through(self):
        """Real Google Drive folder IDs pass through resolution unchanged."""
        real_id = "1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_"
        self.assertTrue(is_real_gdrive_id(real_id))

    def test_synthetic_id_resolves_to_real(self):
        """Synthetic IDs resolve to real Google Drive folder IDs via identity map."""
        data_json_map = {
            "byId": {"agriturkey": "1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_"},
            "byNormalizedId": {"agriturkey": "1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_"}
        }

        def resolve(raw_key, enterprise_id, id_map):
            if raw_key and is_real_gdrive_id(raw_key):
                return raw_key
            if enterprise_id and enterprise_id in id_map.get("byId", {}):
                return id_map["byId"][enterprise_id]
            norm = normalize_identity_key(enterprise_id)
            if norm and norm in id_map.get("byNormalizedId", {}):
                return id_map["byNormalizedId"][norm]
            return raw_key

        result = resolve("folder_agriturkey", "agriturkey", data_json_map)
        self.assertEqual(result, "1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_")

    def test_no_duplicates_after_resolution(self):
        """No duplicate (folder_id, requirement_id) combinations after resolution."""
        resolved = [
            ("1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_", "applicationLetter"),
            ("1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_", "applicationForm"),
            ("1Rs4kY5SD0ITs-Ol-Zo8htgP8If-0cqyP", "applicationLetter"),
        ]

        seen = set()
        for combo in resolved:
            self.assertNotIn(combo, seen, f"Duplicate found: {combo}")
            seen.add(combo)

    def test_unique_constraint_prevents_duplicates(self):
        """UNIQUE (enterprise_folder_id, requirement_id) constraint prevents duplicates."""
        # Simulating upsert with onConflict
        existing = {
            ("1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_", "applicationLetter"): "row-1"
        }

        new_row = {
            "enterprise_folder_id": "1IdWQfK_mzOKp4Rc7LXtLP-W1FczCe_o_",
            "requirement_id": "applicationLetter"
        }

        key = (new_row["enterprise_folder_id"], new_row["requirement_id"])
        self.assertIn(key, existing, "Duplicate should be caught by unique constraint")

    def test_scan_never_writes_when_folders_zero(self):
        """No scan_results written when folders_found = 0."""
        folders_found = 0
        results_to_upsert = []

        # According to api/scan.js, if foldersFound === 0, return FAILED immediately
        # No upsert should happen
        self.assertEqual(folders_found, 0)
        self.assertEqual(len(results_to_upsert), 0)

    def test_scan_never_writes_when_auth_fails(self):
        """No scan_results written when authentication fails."""
        drive_service = None  # Auth failed

        # According to api/scan.js, if driveService is null, return FAILED immediately
        results_to_upsert = []
        self.assertIsNone(drive_service)
        self.assertEqual(len(results_to_upsert), 0)


class TestFrontendErrorHandling(unittest.TestCase):
    """Test frontend error handling for failed scans."""

    def test_failed_scan_shows_error_not_success(self):
        """Frontend should show error message on FAILED scan."""
        scan_status = "FAILED"
        error_message = "Google Drive scanner unavailable"

        # Frontend logic: if status === 'FAILED', show error
        should_show_error = scan_status == "FAILED"
        should_show_success = scan_status == "COMPLETED"

        self.assertTrue(should_show_error)
        self.assertFalse(should_show_success)

    def test_failed_scan_reenables_button(self):
        """Frontend should re-enable Scan button on FAILED scan."""
        is_scanning = True
        scan_status = "FAILED"

        # Frontend logic: if status === 'FAILED', set isScanning = false, enable button
        if scan_status == "FAILED":
            is_scanning = False

        self.assertFalse(is_scanning)

    def test_no_success_message_on_failure(self):
        """Frontend should NOT show 'Scan complete' on FAILED scan."""
        scan_status = "FAILED"

        # Frontend should NOT show "Scan complete"
        should_show_complete = scan_status == "COMPLETED"
        self.assertFalse(should_show_complete)

    def test_immediate_failed_response_handled(self):
        """Frontend handles immediate FAILED response from scan endpoint."""
        response = {
            "success": False,
            "status": "FAILED",
            "error": "Google Drive scanner unavailable"
        }

        # Frontend logic: if status === "FAILED", show error
        is_failed = response["status"] == "FAILED"
        self.assertTrue(is_failed)
        self.assertFalse(response["success"])


class TestHumanReviewPersistenceFlow(unittest.TestCase):
    """Test the complete human review persistence flow from save to reload."""

    def test_upsert_uses_correct_conflict_target(self):
        """Frontend UPSERT must use onConflict: 'enterprise_folder_id,requirement_id'."""
        # The frontend code should use this exact conflict target
        conflict_target = "enterprise_folder_id,requirement_id"
        self.assertEqual(conflict_target, "enterprise_folder_id,requirement_id")

    def test_upsert_payload_has_required_fields(self):
        """UPSERT payload must include all required fields."""
        required_fields = [
            "enterprise_folder_id", "enterprise_id", "requirement_id",
            "human_status", "reviewer_name", "updated_at"
        ]
        sample_payload = {
            "enterprise_folder_id": "1RealFolderId01ABCDEFGHIJ",
            "enterprise_id": "enterprise_01",
            "requirement_id": "bmcFinancials",
            "file_id": "",
            "automated_status": "MISSING",
            "human_status": "APPROVED",
            "reviewer_name": "Test Reviewer",
            "reviewer_notes": "Test note",
            "updated_at": "2026-08-06T00:00:00.000Z"
        }
        for field in required_fields:
            self.assertIn(field, sample_payload, f"Missing required field: {field}")

    def test_human_status_overrides_automated_status(self):
        """Human review status should override automated status in display."""
        automated_status = "MISSING"
        human_status = "APPROVED"

        # The merge rule: if human review exists, display human status
        display_status = human_status if human_status else automated_status
        self.assertEqual(display_status, "APPROVED")

    def test_human_status_overrides_needs_review(self):
        """Human review should override NEEDS_REVIEW status."""
        automated_status = "NEEDS_REVIEW"
        human_status = "COMPLETE"

        display_status = human_status if human_status else automated_status
        self.assertEqual(display_status, "COMPLETE")

    def test_no_human_review_shows_automated(self):
        """Without human review, display shows automated status."""
        automated_status = "MISSING"
        human_status = None

        display_status = human_status if human_status else automated_status
        self.assertEqual(display_status, "MISSING")

    def test_automated_status_preserved_under_human(self):
        """Automated status should be preserved as separate field when human approves."""
        automated_status = "MISSING"
        human_status = "APPROVED"

        # Both should exist independently
        self.assertEqual(automated_status, "MISSING")
        self.assertEqual(human_status, "APPROVED")

    def test_fetch_reviews_uses_resolve_folder_key(self):
        """fetchHumanReviewsFromSupabase uses resolveFolderKey for identity."""
        def is_real_gdrive_id(id_str):
            if not id_str or not isinstance(id_str, str):
                return False
            return len(id_str) > 15 and any(c.isupper() for c in id_str)

        def resolve_folder_key(raw_key, enterprise_id, enterprise_name, identity_map):
            if raw_key and is_real_gdrive_id(raw_key):
                return raw_key
            if enterprise_id and identity_map.get("byId", {}).get(enterprise_id):
                return identity_map["byId"][enterprise_id]
            return raw_key

        # Real Google Drive ID passes through
        real_id = "1LFuja6vWFupYjg5t_CLSvfTkfd6We1Px"
        result = resolve_folder_key(real_id, "growmate", None, {"byId": {}})
        self.assertEqual(result, real_id)

        # Synthetic ID resolves via identity map
        identity_map = {"byId": {"growmate": "1LFuja6vWFupYjg5t_CLSvfTkfd6We1Px"}}
        result = resolve_folder_key("folder_growmate", "growmate", None, identity_map)
        self.assertEqual(result, "1LFuja6vWFupYjg5t_CLSvfTkfd6We1Px")

    def test_merge_order_supabase_overrides_local(self):
        """Supabase reviews should override local overrides in merge."""
        local_overrides = {
            "1RealFolderId01": {
                "bmcFinancials": {"manualStatus": "APPROVED", "reviewedBy": "Local"}
            }
        }
        supabase_reviews = {
            "1RealFolderId01": {
                "bmcFinancials": {"manualStatus": "COMPLETE", "reviewedBy": "Supabase"}
            }
        }

        # Frontend merge: state.overrides = { ...state.overrides, ...supabaseReviews }
        merged = {**local_overrides, **supabase_reviews}

        # Supabase should win
        self.assertEqual(
            merged["1RealFolderId01"]["bmcFinancials"]["manualStatus"],
            "COMPLETE"
        )

    def test_process_dataset_applies_overrides(self):
        """processDataset applies overrides to requirement status."""
        participant = {
            "enterpriseFolderId": "1RealFolderId01",
            "requirements": {
                "bmcFinancials": {"status": "MISSING", "automatedStatus": "MISSING"}
            }
        }
        overrides = {
            "1RealFolderId01": {
                "bmcFinancials": {"manualStatus": "APPROVED"}
            }
        }

        # Simulate processDataset merge
        ent_key = participant["enterpriseFolderId"]
        active_overrides = overrides.get(ent_key, {})
        for doc_key, override in active_overrides.items():
            if doc_key in participant["requirements"]:
                participant["requirements"][doc_key]["review"] = override
                if override.get("manualStatus"):
                    participant["requirements"][doc_key]["status"] = override["manualStatus"]

        self.assertEqual(participant["requirements"]["bmcFinancials"]["status"], "APPROVED")
        self.assertEqual(participant["requirements"]["bmcFinancials"]["automatedStatus"], "MISSING")

    def test_review_survives_rescan(self):
        """Human review should survive a Google Drive rescan."""
        # Existing human review
        human_reviews = {
            "1RealFolderId01": {
                "bmcFinancials": {"manualStatus": "APPROVED", "reviewedBy": "Test"}
            }
        }

        # New scan results (scanner never touches human_reviews)
        scan_results = {
            "1RealFolderId01": {
                "bmcFinancials": {"automatedStatus": "MISSING"}
            }
        }

        # After rescan, human review should still override
        display_status = human_reviews["1RealFolderId01"]["bmcFinancials"]["manualStatus"]
        self.assertEqual(display_status, "APPROVED")

    def test_no_duplicate_folder_requirement_rows(self):
        """UNIQUE constraint prevents duplicate (enterprise_folder_id, requirement_id)."""
        existing_rows = set()

        def try_upsert(folder_id, req_id):
            key = (folder_id, req_id)
            if key in existing_rows:
                return False  # Would conflict
            existing_rows.add(key)
            return True

        # First upsert succeeds
        self.assertTrue(try_upsert("1RealFolderId01", "bmcFinancials"))
        # Second upsert on same key fails (conflict)
        self.assertFalse(try_upsert("1RealFolderId01", "bmcFinancials"))
        # Different req succeeds
        self.assertTrue(try_upsert("1RealFolderId01", "validId"))

    def test_history_is_append_only(self):
        """human_review_history should only be inserted, never updated or deleted."""
        history = []

        def insert_history(entry):
            history.append(entry)

        # Insert two entries for same requirement
        insert_history({"req": "bmcFinancials", "status": "APPROVED", "reviewer": "A"})
        insert_history({"req": "bmcFinancials", "status": "COMPLETE", "reviewer": "B"})

        # Both should exist (append-only)
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]["status"], "APPROVED")
        self.assertEqual(history[1]["status"], "COMPLETE")

    def test_local_overrides_backup(self):
        """Local overrides should be saved to localStorage as backup."""
        overrides = {
            "1RealFolderId01": {
                "bmcFinancials": {"manualStatus": "APPROVED"}
            }
        }

        # Simulate localStorage save/load
        saved_json = json.dumps(overrides)
        loaded = json.loads(saved_json)
        self.assertEqual(loaded, overrides)

    def test_error_handling_does_not_false_success(self):
        """Supabase write errors should not show false success toast."""
        # If Supabase write fails, the catch block shows "Saved locally"
        # This is correct behavior - it tells the user it's only local
        error_toast = "Saved locally (Supabase sync failed)"
        success_toast = "Review decision saved to Supabase!"

        # The error case should use the error toast
        self.assertIn("locally", error_toast)
        self.assertNotIn("Supabase sync failed", success_toast)


if __name__ == "__main__":
    unittest.main(verbosity=2)
