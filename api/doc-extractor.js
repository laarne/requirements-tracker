const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const EXTRACTION_TIMEOUT_MS = 5000;
const MAX_BUFFER_SIZE = 5 * 1024 * 1024;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${ms}ms`)), ms)
    )
  ]);
}

async function extractTextFromPDF(buffer) {
  try {
    const data = await withTimeout(pdfParse(buffer), EXTRACTION_TIMEOUT_MS, 'PDF parse');
    return {
      text: data.text || "",
      numPages: data.numpages || 0,
      info: data.info || {},
      method: "PDF_TEXT_EXTRACTION"
    };
  } catch (e) {
    console.warn("[EXTRACT] PDF text extraction failed:", e.message);
    return { text: "", method: "PDF_FAILED", error: e.message };
  }
}

async function extractTextFromDOCX(buffer) {
  try {
    const result = await withTimeout(mammoth.extractRawText({ buffer }), EXTRACTION_TIMEOUT_MS, 'DOCX mammoth');
    return {
      text: result.value || "",
      method: "DOCX_MAMMOTH",
      warnings: result.messages || []
    };
  } catch (e) {
    console.warn("[EXTRACT] DOCX extraction failed:", e.message);
    return { text: "", method: "DOCX_FAILED", error: e.message };
  }
}

function normalizeText(text) {
  if (!text) return "";
  let n = text.toLowerCase();
  n = n.replace(/[\r\n]+/g, ' ');
  n = n.replace(/\s+/g, ' ');
  n = n.replace(/[^\w\s.,;:!?\-\/]/g, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

async function extractDocumentContent(fileBuffer, filename, mimeType) {
  const lowerName = (filename || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (fileBuffer && fileBuffer.length > MAX_BUFFER_SIZE) {
    console.log(`[EXTRACT] Skipping ${filename}: buffer too large (${fileBuffer.length} bytes)`);
    return { text: "", method: "SKIPPED_TOO_LARGE", filename, mimeType };
  }

  let result = { text: "", method: "NONE", confidence: 0 };

  if (mime === "application/pdf" || lowerName.endsWith(".pdf")) {
    result = await extractTextFromPDF(fileBuffer);
  } else if (mime.includes("word") || lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
    result = await extractTextFromDOCX(fileBuffer);
  } else if (mime.startsWith("image/") || /\.(jpg|jpeg|png|gif|tiff?)$/i.test(lowerName)) {
    console.log(`[EXTRACT] Skipping image OCR for ${filename} (filename-based matching sufficient)`);
    return { text: "", method: "SKIPPED_IMAGE", filename, mimeType };
  } else {
    return { text: "", method: "UNSUPPORTED_TYPE", filename, mimeType };
  }

  if (result.text) {
    result.normalizedText = normalizeText(result.text);
  }

  result.filename = filename;
  result.mimeType = mimeType;

  return result;
}

module.exports = {
  extractDocumentContent,
  extractTextFromPDF,
  extractTextFromDOCX,
  normalizeText
};
