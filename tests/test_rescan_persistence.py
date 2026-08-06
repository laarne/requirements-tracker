"""
tests/test_rescan_persistence.py
=================================
Tests the core compliance persistence guarantee:
  - Human decisions (Mark Complete, Keep Missing) MUST survive a Google Drive rescan.
  - The final_status is always derived from the human decision when one exists.
  - A rescan that does not find a document must NOT overwrite a prior "COMPLETE" decision.
  - A rescan that does find a document must NOT overwrite a prior "MISSING" (Keep Missing) decision.
  - Compliance counts must reflect final_status, not raw scan status.

These tests simulate the processDataset() merge pipeline in app.js using Python.
"""
import json
import copy
import pytest


# ---------------------------------------------------------------------------
# Minimal simulation of the app.js processDataset + merge pipeline
# ---------------------------------------------------------------------------

CANONICAL_REQUIREMENTS = [
    "applicationLetter", "applicationForm", "businessModelCanvas",
    "bmcFinancials", "financialFigures", "validId", "swornStatement",
    "proofOfResidency", "endorsementLetter", "photo2x2", "signatures",
    "declarationOfIntent",
]


def make_participant(folder_id: str, name: str, requirements: dict | None = None) -> dict:
    """Create a minimal participant object with all requirements defaulting to MISSING."""
    reqs = {}
    for k in CANONICAL_REQUIREMENTS:
        reqs[k] = {"status": "MISSING", "automatedStatus": "MISSING", "files": []}
    if requirements:
        reqs.update(requirements)
    return {
        "enterpriseFolderId": folder_id,
        "id": folder_id,
        "name": name,
        "applicantType": "INDIVIDUAL",
        "requirements": reqs,
    }


def apply_scan_results(participant: dict, scan_statuses: dict) -> dict:
    """
    Simulate a fresh Drive rescan: overwrite automatedStatus from Drive.
    This is what fetchScanResultsFromSupabase() + fetchData() do.
    Does NOT touch human_reviews / human decisions.
    """
    p = copy.deepcopy(participant)
    for req_key, status in scan_statuses.items():
        if req_key in p["requirements"]:
            p["requirements"][req_key]["automatedStatus"] = status
            p["requirements"][req_key]["status"] = status  # raw scan status
            p["requirements"][req_key]["files"] = [{"name": f"drive_{req_key}.pdf"}] if status == "COMPLETE" else []
    return p


def apply_human_overrides(participant: dict, overrides: dict) -> dict:
    """
    Simulate processDataset() human-wins merge.
    overrides = { req_key: { manualStatus: "COMPLETE"|"MISSING", verificationSource: "manual", ... } }
    Human decision always takes priority over scan result.
    """
    p = copy.deepcopy(participant)
    # Step 1: preserve automatedStatus and set default verificationSource
    for doc_key, doc in p["requirements"].items():
        if "automatedStatus" not in doc:
            doc["automatedStatus"] = doc["status"]
        doc["finalStatus"] = doc["automatedStatus"]
        doc["verificationSource"] = "drive"

    # Step 2: apply human overrides — human decision wins
    for req_key, override in overrides.items():
        if req_key in p["requirements"] and override.get("manualStatus"):
            st = override["manualStatus"]
            if st in ("NEEDS_REVIEW", "REVIEW"):
                st = "CHECK"
            p["requirements"][req_key]["status"] = st
            p["requirements"][req_key]["finalStatus"] = st
            p["requirements"][req_key]["verificationSource"] = override.get("verificationSource", "manual")
            p["requirements"][req_key]["reviewedBy"] = override.get("reviewedBy", "Admin")
            p["requirements"][req_key]["review"] = override

    return p


def recalculate_scores(participant: dict) -> dict:
    """Count complete, missing, check from doc.status (= final_status after merge)."""
    p = copy.deepcopy(participant)
    reqs = p["requirements"]
    complete = sum(1 for doc in reqs.values()
                   if doc.get("status", "MISSING").upper() in ("COMPLETE", "APPROVED"))
    missing = sum(1 for doc in reqs.values()
                  if doc.get("status", "MISSING").upper() in ("MISSING", "REJECTED"))
    check = sum(1 for doc in reqs.values()
                if doc.get("status", "MISSING").upper() == "CHECK")
    total = len(reqs)
    p["completeCount"] = complete
    p["missingCount"] = missing
    p["checkCount"] = check
    p["applicableRequirementsCount"] = total
    p["scores"] = {"complete": complete, "missing": missing, "check": check, "total": total}
    return p


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestMarkCompleteRescanPersistence:
    """Mark Complete → rescan → decision must survive."""

    def _make_scenario(self):
        """
        Starting state: 4 docs found by Drive, 8 missing (= 4/12).
        Admin marks applicationLetter COMPLETE manually (= 5/12).
        """
        folder_id = "1ABCDEF_test_folder"
        scan_results = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        # Drive found 4 docs
        found_by_drive = ["applicationForm", "businessModelCanvas", "bmcFinancials", "financialFigures"]
        for k in found_by_drive:
            scan_results[k] = "COMPLETE"

        p = make_participant(folder_id, "Test Enterprise Alpha")
        p = apply_scan_results(p, scan_results)
        return p, folder_id, found_by_drive

    def test_initial_scan_score_is_4_of_12(self):
        """Baseline: 4 Drive-found docs → 4/12."""
        p, _, _ = self._make_scenario()
        p_no_override = apply_human_overrides(p, {})
        p_scored = recalculate_scores(p_no_override)
        assert p_scored["completeCount"] == 4
        assert p_scored["missingCount"] == 8
        assert p_scored["applicableRequirementsCount"] == 12

    def test_mark_complete_raises_score_to_5_of_12(self):
        """Mark Complete on applicationLetter → 5/12."""
        p, _, _ = self._make_scenario()
        overrides = {
            "applicationLetter": {
                "manualStatus": "COMPLETE",
                "verificationSource": "manual",
                "reviewedBy": "Admin"
            }
        }
        p_merged = apply_human_overrides(p, overrides)
        p_scored = recalculate_scores(p_merged)
        assert p_scored["completeCount"] == 5
        assert p_scored["missingCount"] == 7

    def test_rescan_does_not_find_doc_but_decision_survives(self):
        """
        Rescan: Drive still does not find applicationLetter (MISSING in scan_results).
        Human decision = COMPLETE must survive. Score stays 5/12.
        """
        p, _, _ = self._make_scenario()
        # Simulate rescan: re-apply scan results (Drive still missing applicationLetter)
        rescan_results = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        found_by_drive = ["applicationForm", "businessModelCanvas", "bmcFinancials", "financialFigures"]
        for k in found_by_drive:
            rescan_results[k] = "COMPLETE"
        p_after_rescan = apply_scan_results(make_participant("1ABCDEF_test_folder", "Test Enterprise Alpha"), rescan_results)

        # Human overrides (loaded from Supabase, survive rescan)
        overrides = {
            "applicationLetter": {
                "manualStatus": "COMPLETE",
                "verificationSource": "manual",
                "reviewedBy": "Admin"
            }
        }
        p_merged = apply_human_overrides(p_after_rescan, overrides)
        p_scored = recalculate_scores(p_merged)

        assert p_scored["completeCount"] == 5, \
            f"Expected 5/12 after rescan, got {p_scored['completeCount']}/12"
        assert p_scored["missingCount"] == 7
        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE"
        assert p_merged["requirements"]["applicationLetter"]["verificationSource"] == "manual"

    def test_rescan_finds_new_doc_adds_to_score(self):
        """
        Rescan: Drive now finds swornStatement (newly uploaded).
        This must automatically become COMPLETE (= 6/12 with the manual one too).
        """
        p, folder_id, _ = self._make_scenario()
        rescan_results = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        found_by_drive = ["applicationForm", "businessModelCanvas", "bmcFinancials", "financialFigures", "swornStatement"]
        for k in found_by_drive:
            rescan_results[k] = "COMPLETE"
        p_after_rescan = apply_scan_results(make_participant(folder_id, "Test Enterprise Alpha"), rescan_results)

        overrides = {
            "applicationLetter": {
                "manualStatus": "COMPLETE",
                "verificationSource": "manual",
                "reviewedBy": "Admin"
            }
        }
        p_merged = apply_human_overrides(p_after_rescan, overrides)
        p_scored = recalculate_scores(p_merged)

        assert p_scored["completeCount"] == 6, \
            f"Expected 6/12 (4 old Drive + 1 new Drive + 1 manual), got {p_scored['completeCount']}/12"
        assert p_merged["requirements"]["swornStatement"]["verificationSource"] == "drive"
        assert p_merged["requirements"]["applicationLetter"]["verificationSource"] == "manual"

    def test_genuinely_missing_docs_stay_missing(self):
        """Docs not found by Drive and without manual decision stay MISSING."""
        p, folder_id, found_by_drive = self._make_scenario()
        overrides = {
            "applicationLetter": {
                "manualStatus": "COMPLETE",
                "verificationSource": "manual",
                "reviewedBy": "Admin"
            }
        }
        p_merged = apply_human_overrides(p, overrides)
        p_scored = recalculate_scores(p_merged)

        for req_key in CANONICAL_REQUIREMENTS:
            if req_key not in found_by_drive and req_key != "applicationLetter":
                doc = p_merged["requirements"][req_key]
                assert doc["finalStatus"] == "MISSING", \
                    f"Expected {req_key} to be MISSING, got {doc['finalStatus']}"


class TestKeepMissingRescanPersistence:
    """Keep Missing → rescan finds doc → Keep Missing decision must survive."""

    def test_keep_missing_survives_drive_finding_document(self):
        """
        Scenario: Admin explicitly keeps a requirement Missing.
        Drive later finds a file matching that requirement.
        The Keep Missing human decision must NOT be overridden.
        """
        folder_id = "1KEEPMISSING_test"
        p = make_participant(folder_id, "Test Enterprise Beta")

        # Drive rescan finds applicationLetter
        rescan_results = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        rescan_results["applicationLetter"] = "COMPLETE"
        p_after_rescan = apply_scan_results(p, rescan_results)

        # Admin had previously clicked "Keep Missing" on applicationLetter
        overrides = {
            "applicationLetter": {
                "manualStatus": "MISSING",
                "verificationSource": "manual",
                "reviewedBy": "Admin"
            }
        }
        p_merged = apply_human_overrides(p_after_rescan, overrides)
        p_scored = recalculate_scores(p_merged)

        # Even though Drive found the doc, the human "Keep Missing" wins
        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "MISSING"
        assert p_merged["requirements"]["applicationLetter"]["verificationSource"] == "manual"
        # Drive scan still shows it as COMPLETE internally (evidence preserved)
        assert p_merged["requirements"]["applicationLetter"]["automatedStatus"] == "COMPLETE"


class TestVerificationSourceLabels:
    """Verify verificationSource is correctly set per requirement after merge."""

    def test_drive_found_docs_have_drive_source(self):
        folder_id = "1SOURCES_test"
        p = make_participant(folder_id, "Test Source Enterprise")
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        scan["applicationForm"] = "COMPLETE"
        p = apply_scan_results(p, scan)
        p_merged = apply_human_overrides(p, {})

        assert p_merged["requirements"]["applicationForm"]["verificationSource"] == "drive"
        assert p_merged["requirements"]["applicationForm"]["finalStatus"] == "COMPLETE"

    def test_manually_completed_docs_have_manual_source(self):
        folder_id = "1SOURCES_test"
        p = make_participant(folder_id, "Test Source Enterprise")
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        p = apply_scan_results(p, scan)
        overrides = {
            "applicationLetter": {"manualStatus": "COMPLETE", "verificationSource": "manual", "reviewedBy": "Admin"}
        }
        p_merged = apply_human_overrides(p, overrides)

        assert p_merged["requirements"]["applicationLetter"]["verificationSource"] == "manual"
        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE"

    def test_unreviewed_missing_docs_have_drive_source(self):
        folder_id = "1SOURCES_test"
        p = make_participant(folder_id, "Test Source Enterprise")
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        p = apply_scan_results(p, scan)
        p_merged = apply_human_overrides(p, {})

        assert p_merged["requirements"]["validId"]["verificationSource"] == "drive"
        assert p_merged["requirements"]["validId"]["finalStatus"] == "MISSING"


class TestComplianceCountFromFinalStatus:
    """Compliance counts must use final_status not raw automated scan status."""

    def test_compliance_count_uses_final_status(self):
        """
        4 Drive-found + 1 manually verified = 5/12.
        Must remain 5/12 after simulated rescan even though Drive sees only 4.
        """
        folder_id = "1COMPLIANCE_test"
        p = make_participant(folder_id, "Compliance Count Enterprise")

        # Before rescan: 4 Drive-found
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        for k in ["applicationForm", "businessModelCanvas", "bmcFinancials", "financialFigures"]:
            scan[k] = "COMPLETE"
        p = apply_scan_results(p, scan)
        overrides = {
            "applicationLetter": {"manualStatus": "COMPLETE", "verificationSource": "manual", "reviewedBy": "Admin"}
        }
        p_merged = apply_human_overrides(p, overrides)
        p_scored = recalculate_scores(p_merged)

        assert p_scored["completeCount"] == 5
        assert p_scored["missingCount"] == 7
        assert p_scored["applicableRequirementsCount"] == 12

        # Simulate rescan: Drive still only sees 4
        p2 = make_participant(folder_id, "Compliance Count Enterprise")
        p2 = apply_scan_results(p2, scan)  # same scan results
        p2_merged = apply_human_overrides(p2, overrides)  # same human overrides from DB
        p2_scored = recalculate_scores(p2_merged)

        assert p2_scored["completeCount"] == 5, \
            f"After rescan: expected 5/12 but got {p2_scored['completeCount']}/12"
        assert p2_scored["missingCount"] == 7
