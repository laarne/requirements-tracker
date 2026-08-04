#!/usr/bin/env python3
"""
Official AI-Powered Participant Requirements Scanner Engine.
Evaluates Google Drive enterprise folders against the canonical program requirements checklist.
Features real local OCR & Content-Based Document Inspection.
Enforces standardized detection methods (FILENAME_ONLY, OCR_CONTENT, FILENAME_AND_OCR, HUMAN_REVIEW),
candidate requirements tracking, explicit console debugging logs, and 4-state status tracking.
"""

import os
import sys
import json
import argparse
import datetime
import logging
import tempfile
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

# Clean invalid system CA bundle env vars pointing to missing files
for _env in ["SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"]:
    _val = os.environ.get(_env)
    if _val and not os.path.exists(_val):
        os.environ.pop(_env, None)

from config import CANONICAL_REQUIREMENTS, ALLOWED_EXTENSIONS, MIN_FILE_SIZE_BYTES, MAX_FILE_SIZE_BYTES, normalize_text
from ocr_helper import extract_document_text

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("scanner")


class DocumentScanner:
    def __init__(self, target_path: str, mode: str = "local", drive_folder_id: Optional[str] = None):
        self.target_path = target_path
        self.mode = mode
        self.drive_folder_id = drive_folder_id or "12KBAKnxhkKOPBQbZXlWLfsolsBUrDf7y"
        self.warnings: List[Dict[str, str]] = []
        self.existing_reviews: Dict[str, Dict[str, Any]] = {}
        self.gdrive_helper = None

    def load_existing_reviews(self, output_path: str):
        """Preserve human reviewer overrides across scans."""
        if os.path.exists(output_path):
            try:
                with open(output_path, "r", encoding="utf-8") as f:
                    old_data = json.load(f)
                    for p in old_data.get("participants", []):
                        pid = p.get("id")
                        reqs = p.get("requirements", {})
                        if pid and reqs:
                            self.existing_reviews[pid] = reqs
                logger.info(f"Loaded existing human reviews for {len(self.existing_reviews)} enterprises.")
            except Exception as e:
                logger.warning(f"Could not load existing reviews from {output_path}: {e}")

    def inspect_and_classify_file(self, file_name: str, file_size: int, local_file_path: Optional[str] = None, mime_type: Optional[str] = None, file_id: Optional[str] = None) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """
        Inspect file content via local OCR and text extraction.
        Returns: (matches_list, ocr_info_dict)
        """
        fname_normalized = normalize_text(file_name)
        ext = os.path.splitext(file_name.lower())[1]

        temp_path = None
        target_path_for_ocr = local_file_path

        # If running in GDrive mode and file needs OCR/inspection, download to temp location
        if not target_path_for_ocr and file_id and self.gdrive_helper:
            if ext in [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".txt", ".doc", ".docx"]:
                temp_dir = tempfile.gettempdir()
                temp_path = os.path.join(temp_dir, f"scan_tmp_{file_id}{ext}")
                success = self.gdrive_helper.download_file_content(file_id, temp_path)
                if success:
                    target_path_for_ocr = temp_path

        ocr_res = {"ocrPerformed": False, "ocrSuccess": False, "characterCount": 0, "extractedText": "", "method": "None"}
        if target_path_for_ocr and os.path.exists(target_path_for_ocr):
            ocr_res = extract_document_text(target_path_for_ocr)

        # Cleanup temporary downloaded file
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

        extracted_text_normalized = normalize_text(ocr_res.get("extractedText", ""))
        all_matches = []

        for req_id, req_cfg in CANONICAL_REQUIREMENTS.items():
            score = 0.0
            reasons = []
            detected_kws = []

            # 1. Filename keyword matching
            filename_matched_kws = [kw for kw in req_cfg["keywords"] if kw in fname_normalized]
            fname_matched = len(filename_matched_kws) > 0
            if fname_matched:
                score += 0.50 + min(len(filename_matched_kws) * 0.15, 0.30)
                reasons.append(f"Filename matches '{filename_matched_kws[0]}'")
                detected_kws.extend(filename_matched_kws)

            # 2. OCR / Content keyword matching
            content_matched_kws = []
            if extracted_text_normalized and req_cfg.get("content_keywords"):
                content_matched_kws = [ckw for ckw in req_cfg["content_keywords"] if ckw in extracted_text_normalized]
                if req_id == "endorsementLetter" and req_cfg.get("office_keywords"):
                    office_kws = [okw for okw in req_cfg["office_keywords"] if okw in extracted_text_normalized]
                    content_matched_kws.extend(office_kws)

                if content_matched_kws:
                    score += 0.45 + min(len(content_matched_kws) * 0.10, 0.30)
                    reasons.append(f"OCR content matches '{content_matched_kws[0]}'")
                    detected_kws.extend(content_matched_kws)

            # 3. Extension & MIME matching
            if ext in req_cfg["extensions"]:
                score += 0.05
            if mime_type and ("image" in mime_type or "pdf" in mime_type or "word" in mime_type):
                score += 0.05

            # 4. Special logic for 2x2 Photo
            if req_id == "photo2x2" and ext in [".jpg", ".jpeg", ".png", ".webp"]:
                if any(k in fname_normalized for k in ["2x2", "2 x 2", "2by2", "photo", "picture", "headshot", "portrait", "avatar"]):
                    score += 0.35
                    reasons.append("Image filename indicates 2x2 photo")

            score = min(max(score, 0.0), 0.99)

            if score >= 0.45:
                if fname_matched and len(content_matched_kws) > 0:
                    det_method = "FILENAME_AND_OCR"
                elif len(content_matched_kws) > 0:
                    det_method = "OCR_CONTENT"
                else:
                    det_method = "FILENAME_ONLY"

                reason_str = "; ".join(reasons) if reasons else f"Matched {req_cfg['name']} criteria"

                snippet_text = ""
                if ocr_res.get("extractedText"):
                    raw_txt = ocr_res["extractedText"]
                    snippet_text = raw_txt[:250] + ("..." if len(raw_txt) > 250 else "")

                all_matches.append({
                    "requirement": req_id,
                    "confidence": round(score, 2),
                    "reason": reason_str,
                    "filenameMatched": fname_matched,
                    "contentMatched": len(content_matched_kws) > 0,
                    "ocrAttempted": ocr_res.get("ocrPerformed", False),
                    "ocrStatus": "SUCCESS" if ocr_res.get("ocrSuccess") else ("FAILED" if ocr_res.get("ocrPerformed") else "NOT_REQUIRED"),
                    "ocrCharacterCount": ocr_res.get("characterCount", 0),
                    "detectionMethod": det_method,
                    "detectedKeywords": list(set(detected_kws)),
                    "snippet": snippet_text
                })

        all_matches.sort(key=lambda x: x["confidence"], reverse=True)
        return all_matches, ocr_res

    def process_enterprise_files(self, file_dicts: List[Dict[str, Any]], participant_id: str, participant_name: str) -> Tuple[Dict[str, Any], str]:
        """Process files inside an enterprise folder with candidate requirements tracking and debugging log output."""
        matched_files_per_req: Dict[str, List[Dict[str, Any]]] = {req_id: [] for req_id in CANONICAL_REQUIREMENTS.keys()}
        has_declaration_of_intent = False
        all_text_combined = ""

        for fd in file_dicts:
            fname = fd["name"]
            fsize = fd.get("size", 0)
            fpath = fd.get("file_path")
            mtype = fd.get("mimeType")
            fid = fd.get("fileId")

            req_matches, ocr_info = self.inspect_and_classify_file(fname, fsize, fpath, mtype, fid)

            top_match_type = "UNCLASSIFIED"
            top_conf_str = "NONE"
            filename_matched_flag = "NO"
            content_matched_flag = "NO"

            if req_matches:
                best_match = req_matches[0]
                top_match_type = CANONICAL_REQUIREMENTS[best_match["requirement"]]["name"].upper()
                top_conf_str = "HIGH" if best_match["confidence"] >= 0.80 else ("MEDIUM" if best_match["confidence"] >= 0.60 else "LOW")
                filename_matched_flag = "YES" if best_match["filenameMatched"] else "NO"
                content_matched_flag = "YES" if best_match["contentMatched"] else "NO"

                # Store candidate requirements considered
                candidate_reqs = [
                    {
                        "requirement": m["requirement"],
                        "name": CANONICAL_REQUIREMENTS[m["requirement"]]["name"],
                        "confidence": m["confidence"]
                    } for m in req_matches[1:]
                ]

                for match in req_matches:
                    req_id = match["requirement"]
                    file_match_obj = {
                        "fileId": fid or "",
                        "name": fname,
                        "mimeType": mtype or "application/octet-stream",
                        "size": fsize,
                        "webViewLink": fd.get("webViewLink") or f"https://drive.google.com/file/d/{fid}/view",
                        "requirement": req_id,
                        "confidence": match["confidence"],
                        "reason": match["reason"],
                        "ocrAttempted": match["ocrAttempted"],
                        "ocrStatus": match["ocrStatus"],
                        "ocrCharacterCount": match["ocrCharacterCount"],
                        "detectionMethod": match["detectionMethod"],
                        "detectedKeywords": match["detectedKeywords"],
                        "snippet": match["snippet"],
                        "candidateRequirements": candidate_reqs
                    }
                    matched_files_per_req[req_id].append(file_match_obj)
                    if req_id == "declarationOfIntent":
                        has_declaration_of_intent = True
            else:
                self.warnings.append({
                    "participant": participant_name,
                    "file": fname,
                    "message": f"Unclassified document format ({fname})"
                })

            all_text_combined += " " + normalize_text(fname) + " " + normalize_text(ocr_info.get("extractedText", ""))

            # Console Debugging Output
            ocr_status_str = "SUCCESS" if ocr_info.get("ocrSuccess") else ("FAILED" if ocr_info.get("ocrPerformed") else "NOT_REQUIRED")
            sys.stdout.write(
                f"\n[DOCUMENT]\n"
                f"Filename: {fname}\n"
                f"MIME: {mtype or 'unknown'}\n"
                f"Content inspection: {'YES' if ocr_info.get('ocrPerformed') else 'NO'}\n"
                f"OCR: {ocr_status_str}\n"
                f"OCR characters: {ocr_info.get('characterCount', 0)}\n"
                f"Filename match: {filename_matched_flag}\n"
                f"Content match: {content_matched_flag}\n"
                f"Detected type: {top_match_type}\n"
                f"Confidence: {top_conf_str}\n"
            )

        p_name_norm = normalize_text(participant_name)
        if has_declaration_of_intent or any(k in p_name_norm for k in ["group", "coop", "association", "team", "managed"]):
            applicant_type = "GROUP"
        else:
            applicant_type = "INDIVIDUAL"

        requirements_res: Dict[str, Any] = {}

        for req_id in CANONICAL_REQUIREMENTS.keys():
            if req_id == "declarationOfIntent" and applicant_type == "INDIVIDUAL":
                requirements_res[req_id] = {
                    "status": "NOT_APPLICABLE",
                    "automatedStatus": "NOT_APPLICABLE",
                    "files": matched_files_per_req[req_id]
                }
                continue

            files = matched_files_per_req[req_id]
            if not files:
                auto_status = "MISSING"
            elif req_id == "bmcFinancials":
                bmc_files = matched_files_per_req.get("businessModelCanvas", [])
                if bmc_files or files:
                    has_fin_text = any(k in all_text_combined for k in ["financial", "income", "balance", "cost", "revenue", "cashflow", "projection"])
                    auto_status = "COMPLETE" if has_fin_text else "NEEDS_REVIEW"
                else:
                    auto_status = "MISSING"
            elif req_id == "financialFigures":
                has_num_text = any(k in all_text_combined for k in ["cashflow", "income", "balance sheet", "expense", "budget", "cost"])
                auto_status = "COMPLETE" if has_num_text and files else ("NEEDS_REVIEW" if files else "MISSING")
            elif req_id == "endorsementLetter":
                office_found = any(k in all_text_combined for k in ["city agriculture", "municipal agriculture", "city agriculturist", "municipal agriculturist", "agriculture office"])
                auto_status = "COMPLETE" if office_found and files else ("NEEDS_REVIEW" if files else "MISSING")
            elif req_id in ["signatures", "photo2x2"]:
                auto_status = "NEEDS_REVIEW" if files else "MISSING"
            elif len(files) > 1:
                auto_status = "NEEDS_REVIEW"
            elif files[0]["confidence"] < 0.65 or files[0]["size"] < MIN_FILE_SIZE_BYTES:
                auto_status = "NEEDS_REVIEW"
            else:
                auto_status = "COMPLETE"

            requirements_res[req_id] = {
                "status": auto_status,
                "automatedStatus": auto_status,
                "files": files
            }

            # Apply preserved manual review overrides
            if participant_id in self.existing_reviews:
                old_req = self.existing_reviews[participant_id].get(req_id, {})
                if old_req.get("review"):
                    requirements_res[req_id]["review"] = old_req["review"]
                    manual_st = old_req["review"].get("manualStatus")
                    if manual_st:
                        requirements_res[req_id]["status"] = manual_st

        return requirements_res, applicant_type

    def _build_enterprise_summary(self, pid: str, name: str, folder_id: str, web_link: str, reqs: Dict[str, Any], applicant_type: str) -> Dict[str, Any]:
        """Calculate compliance based ONLY on applicable required items."""
        applicable_req_keys = [r for r, data in reqs.items() if data["status"] != "NOT_APPLICABLE"]
        total_applicable = len(applicable_req_keys)

        complete_count = 0
        missing_count = 0
        needs_review_count = 0

        for req_id in applicable_req_keys:
            st = reqs[req_id].get("status", "MISSING").upper()
            if st in ["COMPLETE", "APPROVED"]:
                complete_count += 1
            if st == "MISSING":
                missing_count += 1
            if st == "NEEDS_REVIEW":
                needs_review_count += 1

        comp_rate = round((complete_count / total_applicable) * 100, 1) if total_applicable > 0 else 0.0

        if complete_count == total_applicable:
            overall_status = "COMPLETE"
        elif needs_review_count > 0:
            overall_status = "NEEDS_REVIEW"
        elif missing_count > 0:
            overall_status = "INCOMPLETE"
        else:
            overall_status = "NEEDS_REVIEW"

        return {
            "id": pid,
            "name": name,
            "driveFolderId": folder_id,
            "driveUrl": web_link,
            "applicantType": applicant_type,
            "completionRate": comp_rate,
            "status": overall_status,
            "applicableRequirementsCount": total_applicable,
            "completeCount": complete_count,
            "missingCount": missing_count,
            "needsReviewCount": needs_review_count,
            "requirements": reqs
        }

    def run_gdrive_discovery(self):
        """Run discovery mode for Google Drive master folder ID and display file & category breakdown."""
        from gdrive_api_helper import GDriveHelper
        self.gdrive_helper = GDriveHelper()

        sys.stdout.write("\nGoogle Drive Discovery Report\n")
        sys.stdout.write("──────────────────────────────────────────────────\n")

        if not self.gdrive_helper.authenticate():
            sys.stdout.write(f"\nAccess: ✕ Authentication Failed ({self.gdrive_helper.last_error})\n")
            sys.exit(1)

        try:
            metadata = self.gdrive_helper.get_folder_metadata(self.drive_folder_id)
            master_name = metadata.get("name", "List of Enterprises")

            sys.stdout.write(f"\nMaster folder: {master_name}\n")
            sys.stdout.write(f"Master folder ID: {self.drive_folder_id}\n")
            sys.stdout.write("Access: ✓ Authorized\n")

            enterprise_folders = self.gdrive_helper.list_participant_folders(self.drive_folder_id)
            sys.stdout.write(f"Enterprises Discovered: {len(enterprise_folders)}\n\n")

            for idx, ef in enumerate(enterprise_folders, start=1):
                ef_id = ef["id"]
                ef_name = ef["name"]
                files = self.gdrive_helper.list_folder_files_recursive(ef_id)

                file_dicts = [{"fileId": f["fileId"], "name": f["name"], "size": f["size"], "mimeType": f["mimeType"], "webViewLink": f.get("webViewLink")} for f in files]
                pid = ef_name.lower().replace(" ", "-").replace("&", "and")
                reqs, app_type = self.process_enterprise_files(file_dicts, pid, ef_name)

                detected_categories = [CANONICAL_REQUIREMENTS[rk]["name"] for rk, rv in reqs.items() if rv["status"] in ["COMPLETE", "NEEDS_REVIEW", "APPROVED"]]

                sys.stdout.write(f"\n{idx}. {ef_name}\n")
                sys.stdout.write(f"   Folder ID: {ef_id}\n")
                sys.stdout.write(f"   Files Found: {len(files)}\n")
                sys.stdout.write(f"   Applicant Type: {app_type}\n")
                sys.stdout.write(f"   Detected Requirements ({len(detected_categories)}): {', '.join(detected_categories) if detected_categories else 'None'}\n\n")

            sys.stdout.write("Discovery complete.\n\n")
        except Exception as err:
            sys.stdout.write(f"\nError accessing Google Drive folder ID '{self.drive_folder_id}': {err}\n")
            sys.exit(1)

    def scan_gdrive_api(self) -> Dict[str, Any]:
        """Scan via Google Drive API mode for master folder ID."""
        from gdrive_api_helper import GDriveHelper
        self.gdrive_helper = GDriveHelper()
        if not self.gdrive_helper.authenticate():
            err_msg = self.gdrive_helper.last_error or "Authentication failed for Google Drive API."
            logger.error(err_msg)
            return self._build_error_output("google_drive", self.drive_folder_id, "List of Enterprises", err_msg)

        try:
            metadata = self.gdrive_helper.get_folder_metadata(self.drive_folder_id)
            master_name = metadata.get("name", "List of Enterprises")
            enterprise_folders = self.gdrive_helper.list_participant_folders(self.drive_folder_id)
        except Exception as e:
            err_msg = f"Failed to access Google Drive master folder '{self.drive_folder_id}': {e}"
            logger.error(err_msg)
            return self._build_error_output("google_drive", self.drive_folder_id, "List of Enterprises", err_msg)

        participants_res = []
        for ef in enterprise_folders:
            folder_name = ef.get("name", "Unknown Enterprise")
            folder_id = ef.get("id")
            web_link = ef.get("webViewLink") or f"https://drive.google.com/drive/folders/{folder_id}"
            pid = folder_name.lower().replace(" ", "-").replace("_", "-").replace("&", "and")

            logger.info(f"Scanning enterprise folder: {folder_name} (ID: {folder_id})...")
            drive_files = self.gdrive_helper.list_folder_files_recursive(folder_id)

            reqs, app_type = self.process_enterprise_files(drive_files, pid, folder_name)
            p_summary = self._build_enterprise_summary(pid, folder_name, folder_id, web_link, reqs, app_type)
            participants_res.append(p_summary)

        return self._format_final_output("google_drive", self.drive_folder_id, master_name, participants_res)

    def scan_local_folder(self) -> Dict[str, Any]:
        """Scan local folder containing enterprise subfolders."""
        if not os.path.exists(self.target_path):
            err_msg = f"Target directory does not exist: {self.target_path}"
            logger.error(err_msg)
            return self._build_error_output("local", self.target_path, "Local Folder", err_msg)

        participant_folders = []
        try:
            for item in sorted(os.listdir(self.target_path)):
                full_item_path = os.path.join(self.target_path, item)
                if os.path.isdir(full_item_path) and not item.startswith("."):
                    participant_folders.append((item, full_item_path))
        except Exception as e:
            err_msg = f"Error reading root directory {self.target_path}: {e}"
            logger.error(err_msg)
            return self._build_error_output("local", self.target_path, "Local Folder", err_msg)

        participants_res = []
        for folder_name, folder_path in participant_folders:
            pid = folder_name.lower().replace(" ", "-").replace("_", "-")

            file_dicts = []
            for root, _, files in os.walk(folder_path):
                for f in files:
                    if not f.startswith("."):
                        fp = os.path.join(root, f)
                        try:
                            fs = os.path.getsize(fp)
                        except Exception:
                            fs = 0
                        file_dicts.append({
                            "fileId": f,
                            "name": f,
                            "mimeType": "application/octet-stream",
                            "size": fs,
                            "webViewLink": f"file:///{os.path.abspath(fp)}",
                            "file_path": fp
                        })

            reqs, app_type = self.process_enterprise_files(file_dicts, pid, folder_name)
            p_summary = self._build_enterprise_summary(pid, folder_name, folder_name, f"file:///{os.path.abspath(folder_path)}", reqs, app_type)
            participants_res.append(p_summary)

        return self._format_final_output("local", self.target_path, "Local Directory", participants_res)

    def _build_error_output(self, source_type: str, path_val: str, folder_name: str, error_msg: str) -> Dict[str, Any]:
        return {
            "generatedAt": datetime.datetime.now().isoformat(),
            "error": error_msg,
            "source": {"type": source_type, "rootFolderId": path_val, "rootFolderName": folder_name},
            "summary": {"totalEnterprises": 0, "fullyCompliant": 0, "needsReview": 0, "incomplete": 0, "overallComplianceRate": 0.0},
            "warnings": self.warnings,
            "participants": []
        }

    def _format_final_output(self, source_type: str, path_val: str, folder_name: str, participants: List[Dict[str, Any]]) -> Dict[str, Any]:
        total_p = len(participants)
        complete_count = sum(1 for p in participants if p["status"] == "COMPLETE")
        needs_review_count = sum(1 for p in participants if p["status"] == "NEEDS_REVIEW")
        incomplete_count = total_p - complete_count

        avg_comp = (sum(p["completionRate"] for p in participants) / total_p) if total_p > 0 else 0.0

        return {
            "generatedAt": datetime.datetime.now().isoformat(),
            "source": {
                "type": source_type,
                "rootFolderId": path_val,
                "rootFolderName": folder_name
            },
            "summary": {
                "totalEnterprises": total_p,
                "fullyCompliant": complete_count,
                "needsReview": needs_review_count,
                "incomplete": incomplete_count,
                "overallComplianceRate": round(avg_comp, 1)
            },
            "warnings": self.warnings,
            "participants": participants
        }


def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="Official AI-Powered Participant Requirements Scanner Engine")
    parser.add_argument("--folder", type=str, default="./participants", help="Path to local participant root folder")
    parser.add_argument("--output", type=str, default="data.json", help="Path to output data.json file")
    parser.add_argument("--mode", type=str, choices=["local", "gdrive"], default="local", help="Scan mode: local or gdrive")
    parser.add_argument("--drive-folder", type=str, default="12KBAKnxhkKOPBQbZXlWLfsolsBUrDf7y", help="Google Drive Master folder ID")
    parser.add_argument("--discover", action="store_true", help="Run discovery mode to list enterprise folders, file counts, and detected categories")

    args = parser.parse_args()

    scanner = DocumentScanner(target_path=args.folder, mode=args.mode, drive_folder_id=args.drive_folder)

    if args.discover:
        if args.mode != "gdrive":
            print("Note: --discover mode requires --mode gdrive. Switching to gdrive mode.")
        scanner.run_gdrive_discovery()
        return

    scanner.load_existing_reviews(args.output)

    logger.info(f"Starting scanner in '{args.mode}' mode...")
    if args.mode == "local":
        result = scanner.scan_local_folder()
    else:
        result = scanner.scan_gdrive_api()

    if result.get("error"):
        logger.error(f"Scan aborted with error: {result['error']}")

    output_dir = os.path.dirname(os.path.abspath(args.output))
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    if result.get("error"):
        sys.exit(1)

    logger.info(f"Scan complete! Results saved to {args.output}")
    logger.info(f"Enterprises Scanned: {result['summary']['totalEnterprises']}")
    logger.info(f"Overall Compliance Rate: {result['summary']['overallComplianceRate']}%")


if __name__ == "__main__":
    main()
