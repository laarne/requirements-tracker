"""
OCR and Document Text Extraction Module.
Performs local OCR on images (.jpg, .jpeg, .png, .webp) and PDFs.
Uses native Windows Media OCR (Windows.Media.Ocr) and pytesseract.
Strictly local & private; no data is sent to external APIs.
"""

import os
import sys
import subprocess
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("ocr_helper")

HAS_PYPDF = False
try:
    import pypdf
    HAS_PYPDF = True
except ImportError:
    try:
        import PyPDF2 as pypdf
        HAS_PYPDF = True
    except ImportError:
        HAS_PYPDF = False

HAS_PYTESSERACT = False
try:
    import pytesseract
    from PIL import Image
    HAS_PYTESSERACT = True
except ImportError:
    HAS_PYTESSERACT = False


def run_windows_ocr(image_path: str) -> Optional[str]:
    """Execute Windows native Media OCR via PowerShell engine script."""
    if not os.path.exists(image_path):
        return None

    script_path = os.path.abspath("ocr_engine.ps1")
    if not os.path.exists(script_path):
        return None

    try:
        abs_img = os.path.abspath(image_path)
        cmd = ["powershell", "-ExecutionPolicy", "Bypass", "-File", script_path, "-ImagePath", abs_img]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=25, encoding="utf-8", errors="ignore")
        output = result.stdout.strip()
        if "OCR_SUCCESS" in output:
            lines = output.splitlines()
            # Everything after OCR_SUCCESS line
            success_idx = lines.index("OCR_SUCCESS")
            extracted = "\n".join(lines[success_idx + 1:]).strip()
            return extracted
    except Exception as e:
        logger.debug(f"Windows Media OCR execution error: {e}")
    return None


def run_pytesseract_ocr(image_path: str) -> Optional[str]:
    """Execute Tesseract OCR via pytesseract if available."""
    if not HAS_PYTESSERACT or not os.path.exists(image_path):
        return None

    try:
        img = Image.open(image_path)
        text = pytesseract.image_to_string(img)
        return text.strip()
    except Exception as e:
        logger.debug(f"pytesseract error: {e}")
        return None


def extract_document_text(file_path: str) -> Dict[str, Any]:
    """
    Extract text content from an image or PDF document.
    Returns dict with:
    {
      "ocrPerformed": bool,
      "ocrSuccess": bool,
      "characterCount": int,
      "extractedText": str,
      "method": str
    }
    """
    if not os.path.exists(file_path):
        return {
            "ocrPerformed": False,
            "ocrSuccess": False,
            "characterCount": 0,
            "extractedText": "",
            "method": "File Not Found"
        }

    ext = os.path.splitext(file_path)[1].lower()
    text = ""
    method = "None"
    ocr_performed = False
    ocr_success = False

    # 1. Image Files (.jpg, .jpeg, .png, .webp)
    if ext in [".jpg", ".jpeg", ".png", ".webp"]:
        ocr_performed = True
        # Try Windows Native OCR first
        win_text = run_windows_ocr(file_path)
        if win_text and len(win_text.strip()) > 5:
            text = win_text
            method = "Windows Native OCR"
            ocr_success = True
        else:
            # Fallback to Tesseract OCR
            tess_text = run_pytesseract_ocr(file_path)
            if tess_text and len(tess_text.strip()) > 5:
                text = tess_text
                method = "Tesseract OCR"
                ocr_success = True
            else:
                method = "Image OCR Attempted (Low Confidence)"

    # 2. PDF Files (.pdf)
    elif ext == ".pdf":
        if HAS_PYPDF:
            try:
                reader = pypdf.PdfReader(file_path)
                pdf_text = ""
                for page in reader.pages[:4]:
                    t = page.extract_text()
                    if t:
                        pdf_text += t + "\n"

                if len(pdf_text.strip()) > 20:
                    text = pdf_text
                    method = "PDF Selectable Text Extraction"
                else:
                    # PDF contains no selectable text (scanned PDF) -> extract images & run OCR
                    ocr_performed = True
                    extracted_image_texts = []
                    for p_idx, page in enumerate(reader.pages[:3]):
                        if hasattr(page, 'images'):
                            for img_obj in page.images:
                                temp_img_name = f"temp_pdf_page_{p_idx}_{img_obj.name}"
                                temp_img_path = os.path.abspath(temp_img_name)
                                try:
                                    with open(temp_img_path, "wb") as fp:
                                        fp.write(img_obj.data)
                                    img_text = run_windows_ocr(temp_img_path) or run_pytesseract_ocr(temp_img_path)
                                    if img_text:
                                        extracted_image_texts.append(img_text)
                                finally:
                                    if os.path.exists(temp_img_path):
                                        os.remove(temp_img_path)

                    if extracted_image_texts:
                        text = "\n".join(extracted_image_texts)
                        method = "Scanned PDF Image OCR"
                        ocr_success = True
                    else:
                        method = "Scanned PDF (No OCR text detected)"
            except Exception as e:
                logger.debug(f"PDF extraction error: {e}")
                method = f"PDF Error ({e})"

    # 3. Plain Text / CSV / HTML
    elif ext in [".txt", ".csv", ".json", ".xml", ".html"]:
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read(4096)
            method = "Plain Text Extraction"
        except Exception:
            pass

    return {
        "ocrPerformed": ocr_performed,
        "ocrSuccess": ocr_success,
        "characterCount": len(text.strip()),
        "extractedText": text.strip(),
        "method": method
    }
