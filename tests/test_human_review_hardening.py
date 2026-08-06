"""
tests/test_human_review_hardening.py
=====================================
Comprehensive end-to-end hardening tests for human-review persistence.

Covers all 10 required scenarios (A-J) from the audit spec:
  A. Missing in Drive -> Mark Complete -> rescan -> STILL COMPLETE
  B. Found in Drive -> Mark Missing -> rescan -> STILL MISSING
  C. Mark Complete -> refresh -> STILL COMPLETE
  D. Mark Missing -> refresh -> STILL MISSING
  E. Mark Complete twice -> only ONE human_review row (unique upsert)
  F. Mark Missing twice -> only ONE human_review row (unique upsert)
  G. Manual decision -> scan result changes -> manual decision still wins
  H. No human review -> automated Drive result is used
  I. Existing human review -> new scan result does not overwrite it
  J. Enterprise folder IDs remain consistent across scan and review lookup

Also tests the explicit finalStatus rule:
  finalStatus = humanReview.exists ? humanReview.status : automatedDriveStatus

All tests simulate the app.js processDataset() merge pipeline in Python.
Duplicate-row behavior (scenarios E, F) is tested at the data model level.
"""
import copy
import pytest


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CANONICAL_REQUIREMENTS = [
    "applicationLetter", "applicationForm", "businessModelCanvas",
    "bmcFinancials", "financialFigures", "validId", "swornStatement",
    "proofOfResidency", "endorsementLetter", "photo2x2", "signatures",
    "declarationOfIntent",
]

FOLDER_ID = "1ABCDEF_hardening_test"
ENTERPRISE_ID = "test_enterprise"
ENTERPRISE_NAME = "Hardening Test Enterprise"


# ---------------------------------------------------------------------------
# Simulation helpers (mirror app.js logic exactly)
# ---------------------------------------------------------------------------

def make_participant(folder_id=FOLDER_ID, name=ENTERPRISE_NAME):
    """Build a participant with all requirements defaulting to MISSING + automatedStatus."""
    reqs = {}
    for k in CANONICAL_REQUIREMENTS:
        reqs[k] = {
            "status": "MISSING",
            "automatedStatus": "MISSING",
            "finalStatus": "MISSING",
            "verificationSource": "drive",
            "files": []
        }
    return {
        "enterpriseFolderId": folder_id,
        "driveFolderId": folder_id,
        "id": ENTERPRISE_ID,
        "name": name,
        "applicantType": "INDIVIDUAL",
        "requirements": reqs,
    }


def apply_scan(participant, scan_statuses):
    """
    Simulate a Drive rescan: update automatedStatus from Drive.
    This represents what fetchScanResultsFromSupabase() + fetchData() produce.
    The scanner NEVER touches human_reviews / state.overrides.
    """
    p = copy.deepcopy(participant)
    for req_key, status in scan_statuses.items():
        if req_key in p["requirements"]:
            clean_status = status.split(":")[0].strip().upper()
            p["requirements"][req_key]["automatedStatus"] = clean_status
            # Raw scan sets doc.status; merge will override if human review exists
            p["requirements"][req_key]["status"] = clean_status
            p["requirements"][req_key]["finalStatus"] = clean_status
            p["requirements"][req_key]["verificationSource"] = "drive"
            p["requirements"][req_key]["files"] = (
                [{"name": f"drive_{req_key}.pdf"}] if clean_status == "COMPLETE" else []
            )
    return p


def apply_human_overrides(participant, overrides):
    """
    Simulate processDataset() human-wins merge.

    Core business rule (finalStatus rule):
      finalStatus = humanReview.exists ? humanReview.status : automatedDriveStatus

    The EXISTENCE of the override object gives authority — not verificationSource.
    verificationSource is a UI display field only, not the authority signal.

    overrides: { req_key: { manualStatus: str, reviewedBy: str, verificationSource: str, ... } }
    """
    p = copy.deepcopy(participant)

    # Step 1: Set default finalStatus = automatedStatus (Drive evidence)
    for doc_key, doc in p["requirements"].items():
        if "automatedStatus" not in doc:
            doc["automatedStatus"] = doc.get("status", "MISSING")
        doc["finalStatus"] = doc["automatedStatus"]
        doc["verificationSource"] = "drive"

    # Step 2: Apply human overrides — human EXISTENCE wins
    for req_key, override in overrides.items():
        if req_key not in p["requirements"]:
            continue
        manual_status = (override.get("manualStatus") or "").strip().upper()
        if not manual_status:
            # Override exists but has no status — skip (keep Drive result)
            p["requirements"][req_key]["review"] = override
            continue
        if manual_status in ("NEEDS_REVIEW", "REVIEW"):
            manual_status = "CHECK"
        # Human decision takes authority
        p["requirements"][req_key]["status"] = manual_status
        p["requirements"][req_key]["finalStatus"] = manual_status
        p["requirements"][req_key]["verificationSource"] = "manual"
        p["requirements"][req_key]["reviewedBy"] = override.get("reviewedBy", "Admin")
        p["requirements"][req_key]["reviewedAt"] = override.get("reviewedAt", "2026-08-06T00:00:00Z")
        p["requirements"][req_key]["review"] = override

    return p


def score(participant):
    """Recalculate compliance scores from doc.status (= finalStatus after merge)."""
    p = copy.deepcopy(participant)
    reqs = p["requirements"]
    complete = sum(
        1 for doc in reqs.values()
        if doc.get("status", "MISSING").upper() in ("COMPLETE", "APPROVED")
    )
    missing = sum(
        1 for doc in reqs.values()
        if doc.get("status", "MISSING").upper() in ("MISSING", "REJECTED")
    )
    check = sum(
        1 for doc in reqs.values()
        if doc.get("status", "MISSING").upper() == "CHECK"
    )
    p["completeCount"] = complete
    p["missingCount"] = missing
    p["checkCount"] = check
    p["applicableRequirementsCount"] = len(reqs)
    return p


def make_human_reviews_db(rows):
    """
    Simulate the human_reviews DB table as a list of dicts.
    Each dict has: enterprise_folder_id, requirement_id, human_status, updated_at
    Returns the current state (deduped by latest updated_at per enterprise_folder_id+requirement_id).
    """
    # Group by (folder_id, req_id), keep latest updated_at
    db = {}
    for row in rows:
        key = (row["enterprise_folder_id"], row["requirement_id"])
        if key not in db or row["updated_at"] > db[key]["updated_at"]:
            db[key] = row
    return list(db.values())


def upsert_human_review(db_rows, new_row):
    """
    Simulate the correct Supabase upsert with onConflict='enterprise_folder_id,requirement_id'.
    Finds existing row by (enterprise_folder_id, requirement_id).
    If found: updates it (1 row). If not found: inserts (1 row).
    Returns (updated_db_rows, was_update: bool).
    """
    key = (new_row["enterprise_folder_id"], new_row["requirement_id"])
    result = []
    found = False
    for row in db_rows:
        existing_key = (row["enterprise_folder_id"], row["requirement_id"])
        if existing_key == key:
            # Update existing row (not a new insert)
            result.append({**row, **new_row})
            found = True
        else:
            result.append(row)
    if not found:
        result.append(new_row)
    return result, found


def db_to_overrides(db_rows, folder_id):
    """Convert DB rows to the overrides dict format that app.js uses."""
    overrides = {}
    for row in db_rows:
        if row["enterprise_folder_id"] == folder_id:
            overrides[row["requirement_id"]] = {
                "manualStatus": row["human_status"],
                "reviewedBy": row.get("reviewer_name", "Admin"),
                "reviewedAt": row.get("verified_at", row.get("updated_at", "")),
                "verificationSource": row.get("verification_source", "manual"),
            }
    return overrides


# ---------------------------------------------------------------------------
# Test A: Missing in Drive → Mark Complete → rescan → STILL COMPLETE
# ---------------------------------------------------------------------------
class TestScenarioA:
    """Missing in Drive → Mark Complete → rescan → STILL COMPLETE"""

    def test_A_mark_complete_survives_rescan_missing(self):
        """Core acceptance test: manual COMPLETE survives a Drive rescan that finds nothing."""
        db = []
        p = make_participant()

        # Initial scan: all missing
        scan1 = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        p = apply_scan(p, scan1)

        # Admin marks applicationLetter COMPLETE
        db, was_update = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "applicationLetter",
            "human_status": "COMPLETE",
            "reviewer_name": "Admin",
            "verification_source": "manual",
            "verified_at": "2026-08-06T10:00:00Z",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        # Load human decisions from DB and merge
        overrides = db_to_overrides(db, FOLDER_ID)
        p_merged = apply_human_overrides(p, overrides)
        p_scored = score(p_merged)
        assert p_scored["completeCount"] == 1, "After Mark Complete: should be 1/12"

        # RESCAN: Drive still finds nothing
        p2 = make_participant()
        scan2 = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}  # Drive finds nothing
        p2 = apply_scan(p2, scan2)

        # Human decisions are loaded from DB (unaffected by rescan)
        overrides2 = db_to_overrides(db, FOLDER_ID)  # DB unchanged by rescan
        p2_merged = apply_human_overrides(p2, overrides2)
        p2_scored = score(p2_merged)

        assert p2_scored["completeCount"] == 1, \
            f"After rescan: expected STILL 1/12 COMPLETE, got {p2_scored['completeCount']}/12"
        assert p2_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE"
        assert p2_merged["requirements"]["applicationLetter"]["verificationSource"] == "manual"
        # Drive evidence preserved
        assert p2_merged["requirements"]["applicationLetter"]["automatedStatus"] == "MISSING"


# ---------------------------------------------------------------------------
# Test B: Found in Drive → Mark Missing → rescan finds it → STILL MISSING
# ---------------------------------------------------------------------------
class TestScenarioB:
    """Found in Drive → Mark Missing (Keep Missing) → rescan finds it → STILL MISSING"""

    def test_B_keep_missing_survives_drive_finding_document(self):
        """Drive finds a doc. Admin clicks Keep Missing. Drive still finds it after rescan. Must stay Missing."""
        db = []
        p = make_participant()

        # Initial scan: Drive finds applicationForm
        scan1 = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        scan1["applicationForm"] = "COMPLETE"
        p = apply_scan(p, scan1)

        # Without override: applicationForm is COMPLETE (from Drive)
        p_no_override = apply_human_overrides(p, {})
        assert p_no_override["requirements"]["applicationForm"]["finalStatus"] == "COMPLETE"

        # Admin explicitly marks it Missing (Keep Missing decision)
        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "applicationForm",
            "human_status": "MISSING",
            "reviewer_name": "Admin",
            "verification_source": "manual",
            "verified_at": "2026-08-06T10:00:00Z",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        overrides = db_to_overrides(db, FOLDER_ID)
        p_merged = apply_human_overrides(p, overrides)
        assert p_merged["requirements"]["applicationForm"]["finalStatus"] == "MISSING"
        assert p_merged["requirements"]["applicationForm"]["verificationSource"] == "manual"
        # Drive evidence is preserved in automatedStatus
        assert p_merged["requirements"]["applicationForm"]["automatedStatus"] == "COMPLETE"

        # RESCAN: Drive still finds applicationForm
        p2 = make_participant()
        scan2 = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        scan2["applicationForm"] = "COMPLETE"
        p2 = apply_scan(p2, scan2)

        # DB still has the Keep Missing decision (rescan doesn't touch human_reviews)
        overrides2 = db_to_overrides(db, FOLDER_ID)
        p2_merged = apply_human_overrides(p2, overrides2)

        assert p2_merged["requirements"]["applicationForm"]["finalStatus"] == "MISSING", \
            "Keep Missing must survive rescan that finds the document"
        assert p2_merged["requirements"]["applicationForm"]["verificationSource"] == "manual"
        assert p2_merged["requirements"]["applicationForm"]["automatedStatus"] == "COMPLETE"


# ---------------------------------------------------------------------------
# Test C: Mark Complete → refresh → STILL COMPLETE
# ---------------------------------------------------------------------------
class TestScenarioC:
    """Mark Complete → simulate page refresh (reload overrides from DB) → STILL COMPLETE"""

    def test_C_mark_complete_survives_refresh(self):
        """Page refresh = re-run fetchData() which reloads overrides from DB."""
        db = []
        p = make_participant()
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        p = apply_scan(p, scan)

        # Admin marks swornStatement COMPLETE
        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "swornStatement",
            "human_status": "COMPLETE",
            "reviewer_name": "Admin",
            "verification_source": "manual",
            "verified_at": "2026-08-06T10:00:00Z",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        # Simulate page refresh: clear in-memory state, reload from DB
        p_refreshed = make_participant()  # fresh participant (no in-memory overrides)
        p_refreshed = apply_scan(p_refreshed, scan)
        overrides_from_db = db_to_overrides(db, FOLDER_ID)  # reload from Supabase
        p_merged = apply_human_overrides(p_refreshed, overrides_from_db)

        assert p_merged["requirements"]["swornStatement"]["finalStatus"] == "COMPLETE"
        assert p_merged["requirements"]["swornStatement"]["verificationSource"] == "manual"


# ---------------------------------------------------------------------------
# Test D: Mark Missing → refresh → STILL MISSING
# ---------------------------------------------------------------------------
class TestScenarioD:
    """Mark Missing → simulate page refresh → STILL MISSING"""

    def test_D_keep_missing_survives_refresh(self):
        db = []
        p = make_participant()
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        scan["endorsementLetter"] = "COMPLETE"
        p = apply_scan(p, scan)

        # Admin overrides Drive's COMPLETE with Keep Missing
        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "endorsementLetter",
            "human_status": "MISSING",
            "reviewer_name": "Admin",
            "verification_source": "manual",
            "verified_at": "2026-08-06T10:00:00Z",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        # Simulate page refresh
        p_refreshed = make_participant()
        p_refreshed = apply_scan(p_refreshed, scan)
        overrides_from_db = db_to_overrides(db, FOLDER_ID)
        p_merged = apply_human_overrides(p_refreshed, overrides_from_db)

        assert p_merged["requirements"]["endorsementLetter"]["finalStatus"] == "MISSING"
        assert p_merged["requirements"]["endorsementLetter"]["verificationSource"] == "manual"
        # Drive evidence is preserved
        assert p_merged["requirements"]["endorsementLetter"]["automatedStatus"] == "COMPLETE"


# ---------------------------------------------------------------------------
# Test E: Mark Complete twice → only ONE human_review row
# ---------------------------------------------------------------------------
class TestScenarioE:
    """Mark Complete twice (idempotent upsert) → only ONE row in human_reviews."""

    def test_E_mark_complete_twice_one_row(self):
        """The correct conflict key (enterprise_folder_id, requirement_id) means
        second upsert updates the existing row, not creates a duplicate."""
        db = []

        # First Mark Complete
        db, was_update_1 = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "validId",
            "human_status": "COMPLETE",
            "reviewer_name": "Admin",
            "verification_source": "manual",
            "verified_at": "2026-08-06T10:00:00Z",
            "updated_at": "2026-08-06T10:00:00Z",
        })
        assert not was_update_1, "First insert: no existing row"
        assert len(db) == 1

        # Second Mark Complete (same requirement, different timestamp)
        db, was_update_2 = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "validId",
            "human_status": "COMPLETE",
            "reviewer_name": "Admin2",
            "verification_source": "manual",
            "verified_at": "2026-08-06T11:00:00Z",
            "updated_at": "2026-08-06T11:00:00Z",
        })
        assert was_update_2, "Second upsert: should UPDATE existing row"
        assert len(db) == 1, f"Expected 1 row, got {len(db)} (no duplicates)"

        # Verify the latest data is kept
        assert db[0]["reviewer_name"] == "Admin2"
        assert db[0]["verified_at"] == "2026-08-06T11:00:00Z"

    def test_E_wrong_conflict_key_would_create_duplicate(self):
        """Demonstrate that the OLD wrong key (enterprise_id, requirement_id) creates duplicates.
        This confirms why the fix was necessary."""
        # Simulate wrong-key behavior (group by enterprise_id, requirement_id instead)
        def wrong_upsert(db_rows, new_row):
            key = (new_row.get("enterprise_id", ""), new_row["requirement_id"])
            result = []
            found = False
            for row in db_rows:
                existing_key = (row.get("enterprise_id", ""), row["requirement_id"])
                if existing_key == key:
                    result.append({**row, **new_row})
                    found = True
                else:
                    result.append(row)
            if not found:
                result.append(new_row)
            return result, found

        db = []
        row_template = {
            "enterprise_folder_id": FOLDER_ID,
            "enterprise_id": ENTERPRISE_ID,
            "requirement_id": "validId",
            "human_status": "COMPLETE",
            "updated_at": "2026-08-06T10:00:00Z",
        }

        db, _ = wrong_upsert(db, {**row_template, "enterprise_id": ""})  # first (empty enterprise_id)
        db, _ = wrong_upsert(db, {**row_template, "enterprise_id": ENTERPRISE_ID})  # second (with enterprise_id)

        # Wrong key: would find no match when enterprise_id differs → creates duplicate
        # (This confirms the root cause of the bug)
        assert len(db) == 2, "Wrong conflict key creates duplicates when enterprise_id differs"


# ---------------------------------------------------------------------------
# Test F: Mark Missing twice → only ONE human_review row
# ---------------------------------------------------------------------------
class TestScenarioF:
    """Mark Missing twice → only ONE row in human_reviews."""

    def test_F_mark_missing_twice_one_row(self):
        db = []

        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "photo2x2",
            "human_status": "MISSING",
            "updated_at": "2026-08-06T10:00:00Z",
        })
        assert len(db) == 1

        db, was_update = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "photo2x2",
            "human_status": "MISSING",
            "updated_at": "2026-08-06T11:00:00Z",
        })
        assert was_update, "Second upsert should update"
        assert len(db) == 1, f"Expected 1 row, got {len(db)}"


# ---------------------------------------------------------------------------
# Test G: Manual decision → scan result changes → manual still wins
# ---------------------------------------------------------------------------
class TestScenarioG:
    """Manual decision exists → scan result changes in any direction → manual always wins."""

    def test_G_manual_complete_wins_even_when_drive_flips_to_missing(self):
        """Drive had doc, then loses it. Manual COMPLETE must still win."""
        db = []

        # Phase 1: Drive finds doc, admin marks it COMPLETE manually
        scan1 = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        scan1["applicationLetter"] = "COMPLETE"
        p = make_participant()
        p = apply_scan(p, scan1)

        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "applicationLetter",
            "human_status": "COMPLETE",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        # Phase 2: Drive no longer finds the doc (file deleted from Drive?)
        scan2 = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        p2 = make_participant()
        p2 = apply_scan(p2, scan2)
        overrides = db_to_overrides(db, FOLDER_ID)
        p2_merged = apply_human_overrides(p2, overrides)

        assert p2_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE"
        assert p2_merged["requirements"]["applicationLetter"]["automatedStatus"] == "MISSING"

    def test_G_manual_missing_wins_even_when_drive_adds_doc(self):
        """Drive didn't have doc, admin marks Keep Missing, Drive later adds doc. Must stay Missing."""
        db = []

        scan1 = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        p = make_participant()
        p = apply_scan(p, scan1)

        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "businessModelCanvas",
            "human_status": "MISSING",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        # Drive now finds the doc
        scan2 = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        scan2["businessModelCanvas"] = "COMPLETE"
        p2 = make_participant()
        p2 = apply_scan(p2, scan2)
        overrides = db_to_overrides(db, FOLDER_ID)
        p2_merged = apply_human_overrides(p2, overrides)

        assert p2_merged["requirements"]["businessModelCanvas"]["finalStatus"] == "MISSING"
        assert p2_merged["requirements"]["businessModelCanvas"]["automatedStatus"] == "COMPLETE"

    def test_G_manual_wins_after_multiple_rescans(self):
        """Human decision survives 3 consecutive rescans."""
        db = []
        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "applicationLetter",
            "human_status": "COMPLETE",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        for i in range(3):
            p = make_participant()
            scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}  # Drive always misses it
            p = apply_scan(p, scan)
            overrides = db_to_overrides(db, FOLDER_ID)
            p_merged = apply_human_overrides(p, overrides)
            assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE", \
                f"Failed on rescan #{i + 1}"


# ---------------------------------------------------------------------------
# Test H: No human review → automated Drive result is used
# ---------------------------------------------------------------------------
class TestScenarioH:
    """No human review record → automated Drive result is the finalStatus."""

    def test_H_no_override_uses_drive_status_complete(self):
        """Drive finds doc, no human decision → finalStatus = COMPLETE (from Drive)."""
        p = make_participant()
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        scan["financialFigures"] = "COMPLETE"
        p = apply_scan(p, scan)
        p_merged = apply_human_overrides(p, {})  # no overrides

        assert p_merged["requirements"]["financialFigures"]["finalStatus"] == "COMPLETE"
        assert p_merged["requirements"]["financialFigures"]["verificationSource"] == "drive"

    def test_H_no_override_uses_drive_status_missing(self):
        """Drive doesn't find doc, no human decision → finalStatus = MISSING (from Drive)."""
        p = make_participant()
        p_merged = apply_human_overrides(p, {})

        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "MISSING"
        assert p_merged["requirements"]["applicationLetter"]["verificationSource"] == "drive"

    def test_H_empty_overrides_dict_uses_all_drive_statuses(self):
        """Empty overrides → all requirements use Drive scan results."""
        p = make_participant()
        scan = {k: "COMPLETE" for k in CANONICAL_REQUIREMENTS[:4]}  # first 4 complete
        p = apply_scan(p, scan)
        p_merged = apply_human_overrides(p, {})
        p_scored = score(p_merged)

        assert p_scored["completeCount"] == 4
        assert p_scored["missingCount"] == 8
        for k in CANONICAL_REQUIREMENTS[:4]:
            assert p_merged["requirements"][k]["verificationSource"] == "drive"


# ---------------------------------------------------------------------------
# Test I: Existing human review → new scan result does not overwrite it
# ---------------------------------------------------------------------------
class TestScenarioI:
    """Existing human review in DB → new Drive scan result → human review wins."""

    def test_I_scan_write_does_not_touch_human_reviews(self):
        """
        The scanner writes to scan_results only.
        human_reviews is untouched by the scan process.
        After the scan, the human review still determines finalStatus.
        """
        db = [
            {
                "enterprise_folder_id": FOLDER_ID,
                "requirement_id": "applicationLetter",
                "human_status": "COMPLETE",
                "reviewer_name": "Admin",
                "verification_source": "manual",
                "verified_at": "2026-08-06T09:00:00Z",
                "updated_at": "2026-08-06T09:00:00Z",
            }
        ]

        # Simulate scan (DOES NOT modify db)
        # In the real system: api/scan.js writes to scan_results, not human_reviews
        scan_results = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}  # Drive finds nothing

        p = make_participant()
        p = apply_scan(p, scan_results)  # scan_results applied

        # DB is unchanged by scan
        overrides = db_to_overrides(db, FOLDER_ID)
        p_merged = apply_human_overrides(p, overrides)

        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE", \
            "Human review must win even after a scan that finds nothing"
        assert len(db) == 1, "DB must be unmodified by scan"
        assert db[0]["human_status"] == "COMPLETE", "DB record unchanged"

    def test_I_scan_finding_doc_does_not_override_keep_missing(self):
        """Scan finds a doc. Existing Keep Missing decision still wins."""
        db = [
            {
                "enterprise_folder_id": FOLDER_ID,
                "requirement_id": "applicationForm",
                "human_status": "MISSING",
                "verification_source": "manual",
                "updated_at": "2026-08-06T09:00:00Z",
            }
        ]

        # Scan finds the doc
        scan_results = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        scan_results["applicationForm"] = "COMPLETE"

        p = make_participant()
        p = apply_scan(p, scan_results)

        overrides = db_to_overrides(db, FOLDER_ID)
        p_merged = apply_human_overrides(p, overrides)

        assert p_merged["requirements"]["applicationForm"]["finalStatus"] == "MISSING"
        assert p_merged["requirements"]["applicationForm"]["automatedStatus"] == "COMPLETE"


# ---------------------------------------------------------------------------
# Test J: Enterprise folder IDs consistent across scan and review lookup
# ---------------------------------------------------------------------------
class TestScenarioJ:
    """Enterprise folder IDs must be consistent: same ID used in scan, save, and lookup."""

    def test_J_canonical_folder_id_used_throughout(self):
        """
        The participant's enterpriseFolderId is the canonical key.
        Scan results use it. Human reviews use it. Lookup uses it.
        All three must match.
        """
        canonical_folder_id = "1REALFOLDERID_abcdefg"

        # Scan result is indexed by canonical folder ID
        scan_for_folder = canonical_folder_id

        # Human review is saved with canonical folder ID
        db = []
        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": canonical_folder_id,  # must match scan
            "requirement_id": "applicationLetter",
            "human_status": "COMPLETE",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        # Participant loaded from scan uses canonical folder ID
        p = {
            "enterpriseFolderId": canonical_folder_id,
            "driveFolderId": canonical_folder_id,
            "id": "some_enterprise_slug",
            "name": "Test Enterprise",
            "applicantType": "INDIVIDUAL",
            "requirements": {
                k: {"status": "MISSING", "automatedStatus": "MISSING", "files": []}
                for k in CANONICAL_REQUIREMENTS
            }
        }

        # Override lookup uses canonical folder ID
        overrides = db_to_overrides(db, canonical_folder_id)  # lookup by same canonical key
        assert "applicationLetter" in overrides, \
            "Override must be found when folder IDs are consistent"

        p_merged = apply_human_overrides(p, overrides)
        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE"

    def test_J_folder_id_mismatch_causes_override_not_found(self):
        """
        If the save key and lookup key differ, the override will not be found.
        This confirms that key consistency is critical.
        """
        save_folder_id = "1DIFFERENT_FOLDER_ID"
        lookup_folder_id = "1ACTUAL_PARTICIPANT_FOLDER"

        db = []
        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": save_folder_id,  # saved under WRONG key
            "requirement_id": "applicationLetter",
            "human_status": "COMPLETE",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        # Lookup with correct participant folder ID finds nothing
        overrides = db_to_overrides(db, lookup_folder_id)
        assert overrides == {}, "Mismatch: override not found (key inconsistency)"

    def test_J_same_folder_id_for_scan_save_and_lookup(self):
        """Verify the full pipeline uses consistent folder IDs end-to-end."""
        folder_id = "1CONSISTENT_ID"

        # 1. Participant is loaded from scan with folder_id
        p = make_participant(folder_id=folder_id)

        # 2. Override is saved using p.enterpriseFolderId (same as scan)
        save_key = p["enterpriseFolderId"]  # = folder_id
        db = []
        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": save_key,
            "requirement_id": "applicationLetter",
            "human_status": "COMPLETE",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        # 3. Lookup uses enterpriseFolderId (same key)
        overrides = db_to_overrides(db, p["enterpriseFolderId"])  # consistent
        assert "applicationLetter" in overrides

        # 4. Merge works correctly
        p_merged = apply_human_overrides(p, overrides)
        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE"


# ---------------------------------------------------------------------------
# Test: finalStatus rule — explicit rule verification
# ---------------------------------------------------------------------------
class TestFinalStatusRule:
    """Explicitly verify: finalStatus = humanReview.exists ? humanReview.status : automatedDriveStatus"""

    def test_no_human_review_uses_drive_status(self):
        p = make_participant()
        scan = {k: "COMPLETE" for k in ["applicationLetter", "applicationForm"]}
        scan.update({k: "MISSING" for k in CANONICAL_REQUIREMENTS if k not in scan})
        p = apply_scan(p, scan)
        p_merged = apply_human_overrides(p, {})

        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE"
        assert p_merged["requirements"]["applicationLetter"]["verificationSource"] == "drive"
        assert p_merged["requirements"]["validId"]["finalStatus"] == "MISSING"
        assert p_merged["requirements"]["validId"]["verificationSource"] == "drive"

    def test_human_review_exists_overrides_drive(self):
        p = make_participant()
        # Drive says MISSING
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        p = apply_scan(p, scan)

        # Human says COMPLETE
        overrides = {
            "applicationLetter": {
                "manualStatus": "COMPLETE",
                "reviewedBy": "Admin",
                "verificationSource": "manual",
            }
        }
        p_merged = apply_human_overrides(p, overrides)

        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE"
        assert p_merged["requirements"]["applicationLetter"]["automatedStatus"] == "MISSING"
        assert p_merged["requirements"]["applicationLetter"]["verificationSource"] == "manual"

    def test_human_review_missing_overrides_drive_complete(self):
        p = make_participant()
        # Drive says COMPLETE
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        scan["applicationLetter"] = "COMPLETE"
        p = apply_scan(p, scan)

        # Human says MISSING
        overrides = {
            "applicationLetter": {
                "manualStatus": "MISSING",
                "reviewedBy": "Admin",
                "verificationSource": "manual",
            }
        }
        p_merged = apply_human_overrides(p, overrides)

        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "MISSING"
        assert p_merged["requirements"]["applicationLetter"]["automatedStatus"] == "COMPLETE"

    def test_empty_manual_status_falls_back_to_drive(self):
        """Edge case: override exists but manualStatus is empty → use Drive status."""
        p = make_participant()
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        scan["applicationLetter"] = "COMPLETE"
        p = apply_scan(p, scan)

        # Override with empty manualStatus (malformed/corrupted record)
        overrides = {
            "applicationLetter": {
                "manualStatus": "",  # empty — should fall back to Drive
                "reviewedBy": "Admin",
            }
        }
        p_merged = apply_human_overrides(p, overrides)

        # Drive status must be used when manualStatus is empty
        assert p_merged["requirements"]["applicationLetter"]["finalStatus"] == "COMPLETE"
        assert p_merged["requirements"]["applicationLetter"]["verificationSource"] == "drive"


# ---------------------------------------------------------------------------
# Test: Compliance calculation uses finalStatus
# ---------------------------------------------------------------------------
class TestComplianceFromFinalStatus:
    """Compliance counts must come from finalStatus, not raw automated scan status."""

    def test_compliance_uses_final_status_not_automated(self):
        """4 Drive-found + 1 manually-complete = 5/12. Score must be 5/12 after rescan."""
        db = []
        db, _ = upsert_human_review(db, {
            "enterprise_folder_id": FOLDER_ID,
            "requirement_id": "applicationLetter",
            "human_status": "COMPLETE",
            "updated_at": "2026-08-06T10:00:00Z",
        })

        # Rescan: Drive finds 4, misses applicationLetter
        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        for k in ["applicationForm", "businessModelCanvas", "bmcFinancials", "financialFigures"]:
            scan[k] = "COMPLETE"

        p = make_participant()
        p = apply_scan(p, scan)
        overrides = db_to_overrides(db, FOLDER_ID)
        p_merged = apply_human_overrides(p, overrides)
        p_scored = score(p_merged)

        assert p_scored["completeCount"] == 5, \
            f"Expected 5/12 (4 Drive + 1 manual), got {p_scored['completeCount']}/12"
        assert p_scored["missingCount"] == 7

    def test_keep_missing_reduces_compliance(self):
        """Drive finds 5 docs. Admin marks 2 as Keep Missing. Score = 3/12."""
        db = []
        for req in ["applicationForm", "businessModelCanvas"]:
            db, _ = upsert_human_review(db, {
                "enterprise_folder_id": FOLDER_ID,
                "requirement_id": req,
                "human_status": "MISSING",
                "updated_at": "2026-08-06T10:00:00Z",
            })

        scan = {k: "MISSING" for k in CANONICAL_REQUIREMENTS}
        for k in ["applicationForm", "businessModelCanvas", "bmcFinancials", "financialFigures", "applicationLetter"]:
            scan[k] = "COMPLETE"

        p = make_participant()
        p = apply_scan(p, scan)
        overrides = db_to_overrides(db, FOLDER_ID)
        p_merged = apply_human_overrides(p, overrides)
        p_scored = score(p_merged)

        assert p_scored["completeCount"] == 3, \
            f"Expected 3/12 (5 Drive - 2 Keep Missing), got {p_scored['completeCount']}/12"
